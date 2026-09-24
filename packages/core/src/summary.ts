/**
 * Ending a session: resolve anything left open, then freeze the summary the
 * summary screen (and the placement/assessment result screens) replay from.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema as s, type Db } from "@qa/db";
import {
  assessmentPassed,
  observedTheta,
  recalibrate,
  seedInferred,
  type Level,
} from "@qa/scoring";
import { archetypeFor, getContent, type Content } from "./content";
import { AppError } from "./errors";
import { events } from "./events";
import { resolveAbandoned, type SessionConfig } from "./runner";
import { interviewDateOf, loadStates, saveState } from "./states";
import { LEVEL_NAMES, readinessView, statusCounts } from "./status";
import { writeSnapshot } from "./snapshots";

export type SessionSummary = {
  mode: string;
  items: number;
  correct: number;
  voided: number;
  minutes: number;
  accuracy: number;
  readinessBefore: number | null;
  readinessAfter: number | null;
  provisional: boolean;
  headline: string;
  weakestDomain: string | null;
  levelsGained: number;
  levelBreakdown: { working: number; ready: number; familiar: number };
  avgSec: number;
  targetSec: number;
  slowestPosition: number | null;
  moved: { skillId: string; name: string; from: string; to: string; direction: "up" | "down" }[];
  misconceptions: { id: string; label: string; count: number; skillName: string }[];
  fadingCount: number;
  lessons: { skillId: string; name: string; status: string }[];
  placement?: { domains: { id: string; name: string; score: number; items: number; correct: number }[]; inferred: number };
  assessment?: {
    passed: boolean;
    composite: number;
    domains: { id: string; name: string; percent: number; items: number }[];
    recalibrated: { skillId: string; name: string; from: string; to: string }[];
    items: { position: number; skillName: string; correct: boolean; timedOut: boolean; answerHtml: string; solutionHtml: string[]; submitted: string | null }[];
  };
};

export async function endSession(sessionId: string, userId: string, now = new Date()): Promise<SessionSummary> {
  const db = getDb();
  const [session] = await db.select().from(s.sessions).where(and(eq(s.sessions.id, sessionId), eq(s.sessions.userId, userId)));
  if (!session) throw new AppError("NOT_FOUND", "session");
  if (session.endedAt && session.summary) return session.summary as SessionSummary;

  // Abandoned items resolve at session close as timeouts (§9.4); unopened lessons are skipped.
  const open = await db.select().from(s.sessionItems).where(and(eq(s.sessionItems.sessionId, sessionId), inArray(s.sessionItems.status, ["served", "grading"])));
  for (const it of open) await resolveAbandoned(it.id);
  await db.update(s.sessionItems).set({ status: "skipped" }).where(and(eq(s.sessionItems.sessionId, sessionId), eq(s.sessionItems.status, "planned")));

  const content = await getContent();
  const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
  const cfg = session.config as SessionConfig;

  if (session.mode === "placement") await finishPlacement(db, content, userId, cfg, now);
  let assessment: SessionSummary["assessment"];
  if (session.mode === "assessment") assessment = await finishAssessment(db, content, userId, sessionId, cfg, now);

  const summary = await buildSummary(db, content, session, user!, now);
  if (assessment) summary.assessment = assessment;
  if (session.mode === "placement") {
    summary.placement = {
      domains: summary.placement?.domains ?? [],
      inferred: summary.placement?.inferred ?? 0,
    };
  }
  await db
    .update(s.sessions)
    .set({ endedAt: now, summary, readinessAfter: summary.readinessAfter })
    .where(eq(s.sessions.id, sessionId));

  if (session.mode === "placement" || session.mode === "assessment") {
    await writeSnapshot(userId, now, session.mode);
  }
  const name = session.mode === "assessment" ? "assessment_completed" : session.mode === "placement" ? "placement_completed" : "session_completed";
  await events.emit(name, userId, {
    items: summary.items,
    correct: summary.correct,
    duration: summary.minutes,
    levels_gained: summary.levelsGained,
    ...(assessment ? { score: assessment.composite, passed: assessment.passed, recalibrated_skills: assessment.recalibrated.length } : {}),
    ...(session.mode === "placement" ? { abandoned: summary.items < session.targetItems } : {}),
  });
  return summary;
}

async function finishPlacement(db: Db, content: Content, userId: string, cfg: SessionConfig, now: Date) {
  const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
  const arch = archetypeFor(content, cfg.archetypeId);
  const states = await loadStates(db, userId);
  // §7.2 — seed every unattempted required skill from its domain's attempted mean, minus a penalty.
  const seeded = seedInferred(states, content.skillList.filter((k) => content.domainById.get(k.domainId)?.live), Object.keys(arch.required));
  for (const [skillId, st] of seeded) await saveState(db, userId, skillId, st, now, interviewDateOf(user!));
  await db.update(s.users).set({ onboarding: "done" }).where(eq(s.users.id, userId));
}

async function finishAssessment(db: Db, content: Content, userId: string, sessionId: string, cfg: SessionConfig, now: Date): Promise<SessionSummary["assessment"]> {
  const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
  const arch = archetypeFor(content, cfg.archetypeId);
  const rows = await db.select().from(s.responses).where(and(eq(s.responses.sessionId, sessionId)));
  const items = await db.select().from(s.sessionItems).where(eq(s.sessionItems.sessionId, sessionId));
  const verdicts = new Map(items.map((i) => [i.id, i.verdict as { correctHtml?: string; solutionHtml?: string[]; submitted?: string | null } | null]));

  const bySkill = new Map<string, { correct: number; b: number }[]>();
  for (const r of rows) bySkill.set(r.skillId, [...(bySkill.get(r.skillId) ?? []), { correct: r.y, b: r.bBefore }]);
  const states = await loadStates(db, userId);
  const recalibrated: { skillId: string; name: string; from: string; to: string }[] = [];
  for (const [skillId, results] of bySkill) {
    const st = states.get(skillId);
    const obs = observedTheta(results);
    if (!st || obs === null) continue;
    const next = recalibrate(st, obs);
    if (next !== st) {
      await saveState(db, userId, skillId, next, now, interviewDateOf(user!));
      if (next.level !== st.level) {
        recalibrated.push({ skillId, name: content.skills.get(skillId)?.name ?? skillId, from: LEVEL_NAMES[st.level as Level], to: LEVEL_NAMES[next.level as Level] });
        await events.emit("level_changed", userId, { skill: skillId, from: st.level, to: next.level, cause: "recalibration" });
      }
    }
  }
  const doms = Object.keys(arch.weights).filter((d) => (arch.weights[d] ?? 0) > 0);
  const domains = doms.map((d) => {
    const inD = rows.filter((r) => content.skills.get(r.skillId)?.domainId === d);
    return { id: d, name: content.domainById.get(d)?.name ?? d, percent: inD.length ? Math.round((100 * inD.reduce((a, r) => a + r.y, 0)) / inD.length) : 0, items: inD.length };
  });
  const composite = rows.length ? Math.round((100 * rows.reduce((a, r) => a + r.y, 0)) / rows.length) : 0;
  const passed = assessmentPassed(composite, domains.filter((d) => d.items > 0).map((d) => d.percent));
  return {
    passed,
    composite,
    domains,
    recalibrated,
    items: rows
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r, i) => ({
        position: i + 1,
        skillName: content.skills.get(r.skillId)?.name ?? r.skillId,
        correct: r.correct,
        timedOut: r.timedOut,
        answerHtml: verdicts.get(r.sessionItemId)?.correctHtml ?? "",
        solutionHtml: verdicts.get(r.sessionItemId)?.solutionHtml ?? [],
        submitted: verdicts.get(r.sessionItemId)?.submitted ?? null,
      })),
  };
}

async function buildSummary(db: Db, content: Content, session: typeof s.sessions.$inferSelect, user: typeof s.users.$inferSelect, now: Date): Promise<SessionSummary> {
  const rows = await db.select().from(s.responses).where(eq(s.responses.sessionId, session.id));
  const items = await db.select().from(s.sessionItems).where(eq(s.sessionItems.sessionId, session.id));
  const states = await loadStates(db, user.id);
  const view = readinessView(content, states, user.archetypeId, now);
  const correct = rows.filter((r) => r.correct).length;

  // What moved: first level-before vs last level-after per skill in this session.
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (!first.has(r.skillId)) first.set(r.skillId, r.levelBefore);
    last.set(r.skillId, r.levelAfter);
  }
  const lessonItems = items.filter((i) => i.kind !== "item");
  const lessonDone = await db.select().from(s.lessonProgress).where(and(eq(s.lessonProgress.userId, user.id), inArray(s.lessonProgress.skillId, lessonItems.map((i) => i.skillId).concat(["-"]))));
  for (const lp of lessonDone) {
    if (lp.status === "completed" && lp.completedAt && lp.completedAt >= session.startedAt && !first.has(lp.skillId)) {
      first.set(lp.skillId, 0);
      last.set(lp.skillId, states.get(lp.skillId)?.level ?? 1);
    }
  }
  const moved = [...first.entries()]
    .filter(([id, from]) => last.get(id) !== from)
    .map(([id, from]) => {
      const to = last.get(id)!;
      return { skillId: id, name: content.skills.get(id)?.name ?? id, from: LEVEL_NAMES[from as Level], to: LEVEL_NAMES[to as Level], direction: (to > from ? "up" : "down") as "up" | "down" };
    })
    .sort((a, b) => (a.direction === b.direction ? 0 : a.direction === "up" ? -1 : 1));
  const gained = moved.filter((m) => m.direction === "up");

  const misCounts = new Map<string, { count: number; skills: Set<string> }>();
  for (const r of rows) {
    if (!r.misconceptionId) continue;
    const m = misCounts.get(r.misconceptionId) ?? { count: 0, skills: new Set<string>() };
    m.count++;
    m.skills.add(content.skills.get(r.skillId)?.name ?? r.skillId);
    misCounts.set(r.misconceptionId, m);
  }
  const misconceptions = [...misCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([id, m]) => ({ id, label: content.misconceptions.get(id)?.label ?? id, count: m.count, skillName: [...m.skills].join(", ") }));

  const avgSec = rows.length ? rows.reduce((a, r) => a + r.elapsedMs, 0) / rows.length / 1000 : 0;
  const targetSec = rows.length
    ? rows.reduce((a, r) => a + (content.templateByKey.get(`${r.templateId}@${r.templateVersion}`)?.timeLimitSec ?? 120) * 0.5, 0) / rows.length
    : 0;
  const slowest = [...rows].sort((a, b) => b.elapsedMs / (limit(content, b) || 1) - a.elapsedMs / (limit(content, a) || 1))[0];
  const slowestItem = slowest ? items.find((i) => i.id === slowest.sessionItemId) : undefined;
  const counts = statusCounts(content, states, now);
  const minutes = Math.max(1, Math.round((now.getTime() - session.startedAt.getTime()) / 60_000));
  const weakest = view.weakest?.name ?? null;

  const summary: SessionSummary = {
    mode: session.mode,
    items: rows.length,
    correct,
    voided: items.filter((i) => i.status === "ungraded").length,
    minutes,
    accuracy: rows.length ? correct / rows.length : 0,
    readinessBefore: session.readinessBefore,
    readinessAfter: view.score ?? view.rawScore,
    provisional: view.provisional,
    headline: summaryHeadline(correct, rows.length, weakest),
    weakestDomain: weakest,
    levelsGained: gained.length,
    levelBreakdown: {
      working: gained.filter((g) => g.to === "Working").length,
      ready: gained.filter((g) => g.to === "Interview-ready").length,
      familiar: gained.filter((g) => g.to === "Familiar").length,
    },
    avgSec,
    targetSec,
    slowestPosition: slowestItem ? slowestItem.position + 1 : null,
    moved,
    misconceptions,
    fadingCount: counts.fading ?? 0,
    lessons: lessonItems.map((i) => ({ skillId: i.skillId, name: content.skills.get(i.skillId)?.name ?? i.skillId, status: i.status })),
  };
  if (session.mode === "placement") {
    summary.placement = {
      domains: view.domainRows.map((d) => {
        const inD = rows.filter((r) => content.skills.get(r.skillId)?.domainId === d.id);
        return { id: d.id, name: d.name, score: d.score, items: inD.length, correct: inD.filter((r) => r.correct).length };
      }),
      inferred: [...states.values()].filter((st) => st.inferred).length,
    };
  }
  return summary;
}

function limit(content: Content, r: { templateId: string; templateVersion: number }) {
  return content.templateByKey.get(`${r.templateId}@${r.templateVersion}`)?.timeLimitSec ?? 120;
}

/** "18 of 24 correct. Mental math is still the ceiling." — the weakest link named in one sentence (§6.6). */
export function summaryHeadline(correct: number, total: number, weakestDomainName: string | null): string {
  if (!total) return "Session ended before any items were answered.";
  const lead = `${correct} of ${total} correct.`;
  if (!weakestDomainName) return lead;
  const short = weakestDomainName.split(" & ")[0]!;
  return `${lead} ${short.charAt(0).toUpperCase()}${short.slice(1)} is still the ceiling.`;
}
