import { and, eq, inArray } from "drizzle-orm";
import { schema as s, type Db } from "@qa/db";
import { initialSkillState, nextDueAt, type Band, type Level, type RecentOutcome, type SkillState } from "@qa/scoring";

type Row = typeof s.userSkillState.$inferSelect;
export type StoredState = SkillState & { entryBand: Band | null; dueAt: Date | null };

export function fromRow(r: Row): StoredState {
  return {
    theta: r.theta,
    level: r.level as Level,
    coldStreak: r.coldStreak,
    stabilityS: r.stabilityS,
    lastCorrectAt: r.lastCorrectAt,
    attempts: r.attempts,
    levelAttempts: r.levelAttempts,
    inferred: r.inferred,
    lastPassedBand: (r.lastPassedBand as Band | null) ?? null,
    recent: (r.recent as RecentOutcome[]) ?? [],
    entryBand: (r.entryBand as Band | null) ?? null,
    dueAt: r.dueAt,
  };
}

export async function loadStates(db: Db, userId: string, skillIds?: string[]): Promise<Map<string, StoredState>> {
  const where = skillIds?.length
    ? and(eq(s.userSkillState.userId, userId), inArray(s.userSkillState.skillId, skillIds))
    : eq(s.userSkillState.userId, userId);
  const rows = await db.select().from(s.userSkillState).where(where);
  return new Map(rows.map((r) => [r.skillId, fromRow(r)]));
}

export function stateOrInitial(states: Map<string, SkillState>, skillId: string): SkillState {
  return states.get(skillId) ?? initialSkillState();
}

/** Persist one skill's state; `due_at` is stored because the review queue needs an index (tech spec §5). */
export async function saveState(
  db: Db,
  userId: string,
  skillId: string,
  state: SkillState,
  now: Date,
  interviewDate: Date | null,
  extra: { entryBand?: Band | null } = {},
) {
  const row = {
    userId,
    skillId,
    theta: state.theta,
    level: state.level,
    coldStreak: state.coldStreak,
    stabilityS: state.stabilityS,
    lastCorrectAt: state.lastCorrectAt,
    dueAt: nextDueAt(state, now, interviewDate),
    attempts: state.attempts,
    levelAttempts: state.levelAttempts,
    inferred: state.inferred,
    lastPassedBand: state.lastPassedBand,
    recent: state.recent,
    updatedAt: now,
    ...(extra.entryBand !== undefined ? { entryBand: extra.entryBand } : {}),
  };
  await db
    .insert(s.userSkillState)
    .values(row)
    .onConflictDoUpdate({ target: [s.userSkillState.userId, s.userSkillState.skillId], set: row });
}

export function interviewDateOf(user: { interviewDate: string | null }): Date | null {
  return user.interviewDate ? new Date(`${user.interviewDate}T09:00:00Z`) : null;
}
