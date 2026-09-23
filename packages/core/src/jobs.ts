/**
 * Tech spec §4, §16.3 item 5 — jobs are handlers taking a payload, not cron loops.
 * Option A invokes them from EventBridge Scheduler (one Lambda); Option B from an
 * SQS consumer. `apps/jobs` runs them locally.
 */
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb, schema as s } from "@qa/db";
import { cleanup, statsRollup } from "./admin";
import { getContent } from "./content";
import { events } from "./events";
import { sendMail, templates } from "./mail";
import { previewPlan, sweepAbandoned } from "./runner";
import { localDate, writeSnapshot } from "./snapshots";
import { loadStates } from "./states";
import { readinessView, skillView } from "./status";
import { archetypeFor } from "./content";

export const JOB_NAMES = ["sweeper", "snapshots", "daily-plan", "weekly-summary", "outcome-ask", "stats-rollup", "cleanup"] as const;
export type JobName = (typeof JOB_NAMES)[number];
export type JobPayload = { now?: string; force?: boolean };

function localHour(now: Date, tz: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now)) % 24;
  } catch {
    return now.getUTCHours();
  }
}
function localWeekday(now: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(now);
  } catch {
    return "";
  }
}

async function activeUsers(days: number, now: Date) {
  const since = new Date(now.getTime() - days * 86400000);
  return getDb()
    .select()
    .from(s.users)
    .where(and(isNull(s.users.deletedAt), sql`exists (select 1 from sessions x where x.user_id = ${s.users.id} and x.started_at > ${since})`));
}

async function alreadySent(userId: string, name: string, day: string) {
  const rows = await getDb()
    .select({ id: s.events.id })
    .from(s.events)
    .where(and(eq(s.events.userId, userId), eq(s.events.name, name), sql`${s.events.props}->>'day' = ${day}`))
    .limit(1);
  return rows.length > 0;
}

export async function runJob(name: JobName, payload: JobPayload = {}): Promise<Record<string, unknown>> {
  const now = payload.now ? new Date(payload.now) : new Date();
  const db = getDb();
  switch (name) {
    case "sweeper":
      // Every 5 minutes: abandoned items score as timeouts; stuck grading is voided.
      return { resolved: await sweepAbandoned(now) };

    case "snapshots": {
      // Hourly: users whose local time is 03:00 get their daily readiness snapshot.
      let n = 0;
      for (const u of await activeUsers(90, now)) {
        if (!payload.force && localHour(now, u.timezone) !== 3) continue;
        await writeSnapshot(u.id, now);
        n++;
      }
      return { snapshots: n };
    }

    case "daily-plan": {
      // Hourly: at 08:00 local, send Today's plan if anything is waiting (§19.13).
      let sent = 0;
      const users = await db.select().from(s.users).where(isNull(s.users.deletedAt));
      for (const u of users) {
        if (u.prefs.reviewReminders === false || u.onboarding !== "done") continue;
        if (!payload.force && localHour(now, u.timezone) !== 8) continue;
        const day = localDate(now, u.timezone);
        if (await alreadySent(u.id, "review_email_sent", day)) continue;
        // The email is built from a dry run of the composer, so it cannot promise what the session will not deliver.
        const plan = await previewPlan(u.id, now);
        if (!plan.counts.review && !plan.lessonSkillId) continue;
        const content = await getContent();
        await sendMail(u.email, templates.dailyPlan({ minutes: plan.minutes, reviews: plan.counts.review, lesson: plan.lessonSkillId ? content.skills.get(plan.lessonSkillId)?.name ?? null : null, items: plan.items }));
        await events.emit("review_email_sent", u.id, { due_count: plan.counts.review, day });
        sent++;
      }
      return { sent };
    }

    case "weekly-summary": {
      let sent = 0;
      const users = await db.select().from(s.users).where(isNull(s.users.deletedAt));
      const content = await getContent();
      for (const u of users) {
        if (!u.prefs.weeklySummary) continue;
        if (!payload.force && (localWeekday(now, u.timezone) !== "Mon" || localHour(now, u.timezone) !== 8)) continue;
        const day = localDate(now, u.timezone);
        if (await alreadySent(u.id, "weekly_summary_sent", day)) continue;
        const states = await loadStates(db, u.id);
        const view = readinessView(content, states, u.archetypeId, now);
        const arch = archetypeFor(content, u.archetypeId);
        const weekAgo = new Date(now.getTime() - 7 * 86400000);
        const moved = await db
          .select({ skillId: s.responses.skillId, before: s.responses.levelBefore, after: s.responses.levelAfter })
          .from(s.responses)
          .where(and(eq(s.responses.userId, u.id), gte(s.responses.createdAt, weekAgo), sql`${s.responses.levelAfter} <> ${s.responses.levelBefore}`));
        const names = ["Unseen", "Familiar", "Working", "Interview-ready"];
        const [snap] = await db.select().from(s.readinessSnapshots).where(and(eq(s.readinessSnapshots.userId, u.id), gte(s.readinessSnapshots.date, weekAgo.toISOString().slice(0, 10)))).orderBy(s.readinessSnapshots.date).limit(1);
        await sendMail(
          u.email,
          templates.weeklySummary({
            readiness: view.score,
            delta: snap?.readiness !== null && snap?.readiness !== undefined && view.score !== null ? view.score - snap.readiness : null,
            fading: content.skillList.map((k) => skillView(content, k, states, arch, now)).filter((k) => k.fading).slice(0, 5).map((k) => k.name),
            moved: moved.map((m) => `${content.skills.get(m.skillId)?.name ?? m.skillId}: ${names[m.before]} → ${names[m.after]}`),
            weakest: view.weakest?.name ?? null,
          }),
        );
        await events.emit("weekly_summary_sent", u.id, { day });
        sent++;
      }
      return { sent };
    }

    case "outcome-ask": {
      // Seven days after an interview date, if the user opted in (§13.1, §14.4).
      let sent = 0;
      const users = await db.select().from(s.users).where(and(isNull(s.users.deletedAt), sql`${s.users.interviewDate} is not null`));
      for (const u of users) {
        if (!u.prefs.shareOutcomes || !u.interviewDate) continue;
        const due = new Date(`${u.interviewDate}T00:00:00Z`).getTime() + 7 * 86400000;
        if (localDate(new Date(due), "UTC") !== localDate(now, "UTC") && !payload.force) continue;
        if (await alreadySent(u.id, "outcome_email_sent", u.interviewDate)) continue;
        await sendMail(u.email, templates.outcomeAsk(null));
        await events.emit("outcome_email_sent", u.id, { day: u.interviewDate });
        sent++;
      }
      return { sent };
    }

    case "stats-rollup":
      return statsRollup();

    case "cleanup":
      await cleanup(now);
      return { ok: true };
  }
}

export const SCHEDULE: Record<JobName, string> = {
  sweeper: "rate(5 minutes)",
  snapshots: "cron(0 * * * ? *)",
  "daily-plan": "cron(0 * * * ? *)",
  "weekly-summary": "cron(0 * * * ? *)",
  "outcome-ask": "cron(0 9 * * ? *)",
  "stats-rollup": "cron(30 2 * * ? *)",
  cleanup: "cron(0 4 * * ? *)",
};
