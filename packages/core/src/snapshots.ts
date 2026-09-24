/**
 * Tech spec §19.11 — readiness is derived on read, so history needs a snapshot:
 * one row per user per local day, computed exactly as Home computes it.
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema as s } from "@qa/db";
import { isValidated } from "@qa/scoring";
import { getContent } from "./content";
import { loadStates } from "./states";
import { readinessView, statusCounts } from "./status";

export function localDate(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export async function lastPassedAssessmentAt(userId: string): Promise<Date | null> {
  const db = getDb();
  const rows = await db
    .select({ endedAt: s.sessions.endedAt, summary: s.sessions.summary })
    .from(s.sessions)
    .where(and(eq(s.sessions.userId, userId), eq(s.sessions.mode, "assessment")))
    .orderBy(desc(s.sessions.startedAt))
    .limit(10);
  const passed = rows.find((r) => r.endedAt && (r.summary as { assessment?: { passed?: boolean } } | null)?.assessment?.passed);
  return passed?.endedAt ?? null;
}

export async function writeSnapshot(userId: string, now = new Date(), event: string | null = null) {
  const db = getDb();
  const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
  if (!user) return;
  const content = await getContent();
  const states = await loadStates(db, userId);
  const view = readinessView(content, states, user.archetypeId, now);
  const row = {
    userId,
    date: localDate(now, user.timezone),
    readiness: view.score,
    rawReadiness: view.rawScore,
    provisional: view.provisional,
    validated: isValidated(await lastPassedAssessmentAt(userId), now),
    domainScores: Object.fromEntries(view.domainRows.map((d) => [d.id, d.score])),
    statusCounts: statusCounts(content, states, now),
    event,
  };
  await db.insert(s.readinessSnapshots).values(row).onConflictDoUpdate({ target: [s.readinessSnapshots.userId, s.readinessSnapshots.date], set: row });
  await getDb().insert(s.events).values({ name: "readiness_computed", userId, props: { score: view.score, weakest_domain: view.weakestDomain, provisional: view.provisional } });
}
