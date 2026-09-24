/**
 * The session runner (tech spec §4, §8). The hot path for a submission:
 *
 *   1. Claim the served item atomically (served → grading). One statement, no lock.
 *   2. Grade — in-process for numeric and MCQ, over HTTP for symbolic.
 *   3. In one transaction: append the response, update skill state and its
 *      prerequisites, recompute level and due_at, update item difficulty.
 *   4. Return the verdict, solution and deltas.
 *
 * The grader call sits between the claim and the transaction, never inside one.
 */
import { randomInt } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema as s, type Db } from "@qa/db";
import type { Instance } from "@qa/items";
import { shouldRemediate, stepForMisconception } from "@qa/learning";
import {
  ABANDON_AFTER_LIMIT_MS,
  BAND_PRIORS,
  DAY_MS,
  PLACEMENT_ITEMS,
  PLACEMENT_MIN_PER_DOMAIN,
  SEEN_WINDOW_DAYS,
  SESSION_DEFAULT_MINUTES,
  TIMEOUT_GRACE_MS,
  applyToUser,
  initialSkillState,
  predictP,
  type Band,
  type Outcome,
  type SkillState,
} from "@qa/scoring";
import { composePlan, pickBand, pickSkill, type Bucket, type Plan, type Slot } from "./composer";
import { archetypeFor, getContent, requiredDomains, type Content, type SkillInfo, type TemplateRow } from "./content";
import { AppError } from "./errors";
import { events } from "./events";
import { gradeCheckpoint, gradeDrillItem, gradeMain, type Graded } from "./grading";
import { answerHtml, checkpointPayload, clientPayload, instanceFor, solutionHtml } from "./instances";
import { rateLimit } from "./ratelimit";
import { interviewDateOf, loadStates, saveState, type StoredState } from "./states";
import { practiceUnlocked, readinessView } from "./status";

export const SKILL_PRACTICE_ITEMS = 8;
import { renderTex } from "./tex";

export type Mode = "practice" | "placement" | "assessment" | "review" | "drill";
type SessionRow = typeof s.sessions.$inferSelect;
type ItemRow = typeof s.sessionItems.$inferSelect;
type UserRow = typeof s.users.$inferSelect;

export type SessionConfig = {
  plan: Plan;
  archetypeId: string;
  /** assessment only: hard deadline */
  deadline?: string;
  /** placement only: domain for each slot */
  placementDomains?: string[];
};

export const ASSESSMENT_MINUTES = 45;
export const ASSESSMENT_ITEMS = 34;
const OPEN_SESSION_MAX_AGE_MS = 12 * 3600_000;

async function getUser(db: Db, userId: string): Promise<UserRow> {
  const [u] = await db.select().from(s.users).where(eq(s.users.id, userId));
  if (!u || u.deletedAt) throw new AppError("UNAUTHENTICATED");
  return u;
}

async function getSession(db: Db, sessionId: string, userId: string): Promise<SessionRow> {
  const [row] = await db.select().from(s.sessions).where(and(eq(s.sessions.id, sessionId), eq(s.sessions.userId, userId)));
  if (!row) throw new AppError("NOT_FOUND", "session");
  return row;
}

async function medianSeconds(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: s.itemStats.templateId, med: s.itemStats.medianElapsedMs, n: s.itemStats.responses })
    .from(s.itemStats)
    .where(sql`${s.itemStats.responses} >= 30 and ${s.itemStats.medianElapsedMs} is not null`);
  return new Map(rows.map((r) => [r.id, (r.med ?? 0) / 1000]));
}

async function lessonsDone(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ skillId: s.lessonProgress.skillId })
    .from(s.lessonProgress)
    .where(and(eq(s.lessonProgress.userId, userId), inArray(s.lessonProgress.status, ["completed", "skipped"])));
  return new Set(rows.map((r) => r.skillId));
}

async function openRemediation(db: Db, userId: string) {
  return db
    .select({ skillId: s.remediation.skillId, misconceptionId: s.remediation.misconceptionId })
    .from(s.remediation)
    .where(and(eq(s.remediation.userId, userId), isNull(s.remediation.resolvedAt)));
}

/** The daily plan as Home shows it (and the daily email sends): a dry run of the composer. */
export async function previewPlan(userId: string, now = new Date()): Promise<Plan> {
  const db = getDb();
  const [user, content] = await Promise.all([getUser(db, userId), getContent()]);
  const states = await loadStates(db, userId);
  const view = readinessView(content, states, user.archetypeId, now);
  return composePlan({
    content,
    states,
    arch: archetypeFor(content, user.archetypeId),
    now,
    minutes: user.prefs.dailyMinutes ?? SESSION_DEFAULT_MINUTES,
    weakestDomainId: view.weakestDomain,
    openRemediation: await openRemediation(db, userId),
    lessonsDone: await lessonsDone(db, userId),
    medianSec: await medianSeconds(db),
  });
}

// ── Starting a session ──────────────────────────────────────────────────────

export async function startSession(userId: string, mode: Mode, now = new Date(), opts: { skillId?: string } = {}) {
  const db = getDb();
  const user = await getUser(db, userId);
  const content = await getContent();
  const arch = archetypeFor(content, user.archetypeId);

  // Session resume (edge state): an unfinished session of the same mode is continued, not duplicated.
  const [open] = opts.skillId ? [] : await db
    .select()
    .from(s.sessions)
    .where(and(eq(s.sessions.userId, userId), eq(s.sessions.mode, mode), isNull(s.sessions.endedAt), gt(s.sessions.startedAt, new Date(now.getTime() - OPEN_SESSION_MAX_AGE_MS))))
    .orderBy(desc(s.sessions.startedAt))
    .limit(1);
  if (open) return { sessionId: open.id, resumed: true };

  await rateLimit("session", userId);
  const states = await loadStates(db, userId);
  const view = readinessView(content, states, user.archetypeId, now);
  let plan: Plan;
  const config: Partial<SessionConfig> = { archetypeId: arch.id };

  if (mode === "placement") {
    const doms = requiredDomains(content, arch).filter((d) => d.live);
    const quota = placementQuota(doms.map((d) => ({ id: d.id, weight: arch.weights[d.id] ?? 0 })));
    config.placementDomains = interleaveQuota(quota);
    plan = emptyPlan(config.placementDomains.map(() => ({ kind: "item", bucket: "placement" })));
  } else if (mode === "assessment") {
    const { assessmentUnlock } = await import("@qa/scoring");
    const last = await lastAssessment(db, userId);
    const unlock = assessmentUnlock(states.values(), user.createdAt, last?.startedAt ?? null, now);
    if (!unlock.unlocked) throw new AppError("ASSESSMENT_LOCKED", unlock.nextAllowedAt ? `next attempt from ${unlock.nextAllowedAt.toISOString()}` : "not yet unlocked");
    plan = emptyPlan(Array.from({ length: ASSESSMENT_ITEMS }, () => ({ kind: "item" as const, bucket: "assessment" as const })));
    config.deadline = new Date(now.getTime() + ASSESSMENT_MINUTES * 60_000).toISOString();
  } else if (opts.skillId) {
    const skill = content.skills.get(opts.skillId);
    if (!skill || !content.templatesBySkill.has(skill.id)) throw new AppError("NOT_FOUND", "skill");
    if (!practiceUnlocked(skill, states)) throw new AppError("EMPTY_QUEUE", "practice for this skill is still locked");
    plan = emptyPlan(Array.from({ length: SKILL_PRACTICE_ITEMS }, () => ({ kind: "item" as const, bucket: "new" as Bucket, skillId: skill.id })));
    plan.counts.new = SKILL_PRACTICE_ITEMS;
  } else {
    plan = composePlan({
      content,
      states,
      arch,
      now,
      minutes: mode === "review" ? 15 : user.prefs.dailyMinutes ?? SESSION_DEFAULT_MINUTES,
      weakestDomainId: view.weakestDomain,
      openRemediation: mode === "practice" ? await openRemediation(db, userId) : [],
      lessonsDone: mode === "practice" ? await lessonsDone(db, userId) : new Set(content.lessons.keys()),
      medianSec: await medianSeconds(db),
    });
    if (mode === "review") plan.slots = plan.slots.filter((x) => x.kind === "item").map((x) => ({ ...x, bucket: "review" as Bucket }));
    if (!plan.slots.length) throw new AppError("EMPTY_QUEUE", "nothing can be served right now");
  }
  config.plan = plan;

  const [row] = await db
    .insert(s.sessions)
    .values({ userId, mode, targetItems: plan.slots.filter((x) => x.kind === "item").length, config, readinessBefore: view.score ?? view.rawScore })
    .returning();
  await events.emit("session_started", userId, { mode, target_items: row!.targetItems, composition: plan.counts });
  if (mode === "placement") await events.emit("placement_started", userId);
  return { sessionId: row!.id, resumed: false };
}

function emptyPlan(slots: Slot[]): Plan {
  return { slots, minutes: 0, items: slots.length, counts: { lessons: 0, refreshers: 0, review: 0, weakest: 0, new: slots.length }, lessonSkillId: null, reviewsDue: 0, weakestDomainId: null };
}

/** §7.1 — at least 5 per required domain, the remainder by profile weight (largest remainder). */
export function placementQuota(domains: { id: string; weight: number }[], total = PLACEMENT_ITEMS): Map<string, number> {
  const q = new Map(domains.map((d) => [d.id, PLACEMENT_MIN_PER_DOMAIN]));
  let left = total - PLACEMENT_MIN_PER_DOMAIN * domains.length;
  const W = domains.reduce((a, d) => a + d.weight, 0) || 1;
  const shares = domains.map((d) => ({ id: d.id, exact: (left * d.weight) / W }));
  for (const sh of shares) q.set(sh.id, q.get(sh.id)! + Math.floor(sh.exact));
  left -= shares.reduce((a, sh) => a + Math.floor(sh.exact), 0);
  for (const sh of [...shares].sort((a, b) => (b.exact % 1) - (a.exact % 1)).slice(0, Math.max(0, left))) q.set(sh.id, q.get(sh.id)! + 1);
  return q;
}

function interleaveQuota(q: Map<string, number>): string[] {
  const left = new Map(q);
  const out: string[] = [];
  while ([...left.values()].some((n) => n > 0)) {
    for (const [d, n] of [...left.entries()].sort((a, b) => b[1] - a[1])) {
      if (n > 0) {
        out.push(d);
        left.set(d, n - 1);
      }
    }
  }
  return out;
}

async function lastAssessment(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(s.sessions)
    .where(and(eq(s.sessions.userId, userId), eq(s.sessions.mode, "assessment")))
    .orderBy(desc(s.sessions.startedAt))
    .limit(1);
  return row ?? null;
}

// ── Serving ─────────────────────────────────────────────────────────────────

async function sessionItems(db: Db, sessionId: string): Promise<ItemRow[]> {
  return db.select().from(s.sessionItems).where(eq(s.sessionItems.sessionId, sessionId)).orderBy(asc(s.sessionItems.position));
}

export type NextResult =
  | { done: true; sessionId: string }
  | { done: false; sessionId: string; kind: "lesson" | "refresher"; sessionItemId: string; skillId: string; skillName: string; position: number; total: number; misconceptionId: string | null }
  | ({ done: false; sessionId: string; kind: "item" } & ServedItem);

export type ServedItem = {
  sessionItemId: string;
  mode: string;
  position: number;
  total: number;
  skillId: string;
  skillName: string;
  domainName: string;
  seed: number;
  unseen: boolean;
  servedAt: string;
  now: string;
  status: string;
  item: ReturnType<typeof clientPayload>;
  /** multi-step: results so far and the next prompt; drill: answers so far */
  progress: unknown;
  /** server-measured time since served, so the client clock never starts from its own guess */
  elapsedMs: number;
  history: { status: string; ok: boolean | null }[];
};

export async function serveNext(sessionId: string, userId: string, now = new Date()): Promise<NextResult> {
  const db = getDb();
  const session = await getSession(db, sessionId, userId);
  if (session.endedAt) return { done: true, sessionId };
  const cfg = session.config as SessionConfig;
  const content = await getContent();
  const items = await sessionItems(db, sessionId);

  if (cfg.deadline && now.getTime() > new Date(cfg.deadline).getTime()) return { done: true, sessionId };

  // An open item is resumed, clock still running: refresh does not reset the timer.
  const openItem = items.find((i) => i.kind === "item" && (i.status === "served" || i.status === "grading"));
  if (openItem) return { done: false, sessionId, kind: "item", ...(await servedPayload(db, content, session, openItem, items, now)) };
  const openLesson = items.find((i) => i.kind !== "item" && i.status === "planned");
  if (openLesson) {
    return {
      done: false,
      sessionId,
      kind: openLesson.kind as "lesson" | "refresher",
      sessionItemId: openLesson.id,
      skillId: openLesson.skillId,
      skillName: content.skills.get(openLesson.skillId)?.name ?? openLesson.skillId,
      position: openLesson.position,
      total: cfg.plan.slots.length,
      misconceptionId: (openLesson.progress as { misconceptionId?: string } | null)?.misconceptionId ?? null,
    };
  }

  const position = items.length;
  const slot = cfg.plan.slots[position];
  if (!slot) return { done: true, sessionId };
  const user = await getUser(db, userId);

  if (slot.kind !== "item") {
    const [row] = await db
      .insert(s.sessionItems)
      .values({ sessionId, userId, position, kind: slot.kind, bucket: slot.bucket, skillId: slot.skillId!, status: "planned", progress: { misconceptionId: slot.misconceptionId ?? null } })
      .returning();
    return {
      done: false,
      sessionId,
      kind: slot.kind,
      sessionItemId: row!.id,
      skillId: slot.skillId!,
      skillName: content.skills.get(slot.skillId!)?.name ?? slot.skillId!,
      position,
      total: cfg.plan.slots.length,
      misconceptionId: slot.misconceptionId ?? null,
    };
  }

  const states = await loadStates(db, userId);
  const arch = archetypeFor(content, cfg.archetypeId);
  const history = items.filter((i) => i.kind === "item").map((i) => i.skillId);
  const chosen = await chooseItem(db, content, session, cfg, slot, position, items, states, arch, user, now, history);
  if (!chosen) {
    // Nothing servable for this slot: skip it rather than stall the session.
    await db.insert(s.sessionItems).values({ sessionId, userId, position, kind: "item", bucket: slot.bucket, skillId: history[history.length - 1] ?? content.skillList[0]!.id, status: "skipped" });
    return serveNext(sessionId, userId, now);
  }
  const { skill, template, seed, inst, seen, bucket } = chosen;
  const [stats] = await db.select().from(s.itemStats).where(and(eq(s.itemStats.templateId, template.id), eq(s.itemStats.version, template.version)));
  const theta = states.get(skill.id)?.theta ?? initialSkillState().theta;
  const p = predictP(theta, stats?.b ?? BAND_PRIORS[template.band]);

  // served_at is the last thing the handler writes: the clock starts when the item leaves the server.
  const [row] = await db
    .insert(s.sessionItems)
    .values({
      sessionId,
      userId,
      position,
      kind: "item",
      bucket,
      skillId: skill.id,
      templateId: template.id,
      templateVersion: template.version,
      seed,
      instanceHash: inst.instanceHash,
      band: template.band,
      status: "served",
      predictedP: p,
      progress: seen ? { seen: true } : null,
      servedAt: sql`now()` as unknown as Date,
    })
    .returning();
  await events.emit("item_served", userId, { template: template.id, version: template.version, band: template.band, type: template.type, skill: skill.id, bucket, predicted_p: p });
  return { done: false, sessionId, kind: "item", ...(await servedPayload(db, content, session, row!, [...items, row!], now)) };
}

async function chooseItem(
  db: Db,
  content: Content,
  session: SessionRow,
  cfg: SessionConfig,
  slot: Slot,
  position: number,
  items: ItemRow[],
  states: Map<string, StoredState>,
  arch: ReturnType<typeof archetypeFor>,
  user: UserRow,
  now: Date,
  history: string[],
) {
  const rand = () => randomInt(0, 1 << 30) / (1 << 30);
  let skill: SkillInfo | undefined;
  let bucket: Bucket = slot.bucket;
  let band: Band | undefined;
  let typeFilter: (t: TemplateRow) => boolean = () => true;

  if (session.mode === "placement") {
    const domainId = cfg.placementDomains![position]!;
    const inDomain = items.filter((i) => i.kind === "item" && content.skills.get(i.skillId)?.domainId === domainId && i.status !== "skipped");
    const answered = await db
      .select({ correct: s.responses.correct, sessionItemId: s.responses.sessionItemId })
      .from(s.responses)
      .where(eq(s.responses.sessionId, session.id));
    const correctById = new Map(answered.map((r) => [r.sessionItemId, r.correct]));
    const hubId = content.domainById.get(domainId)?.hubSkillId;
    // Placement items must be fast and unambiguous: no symbolic, multi-step or drill items (syllabus §9.1).
    typeFilter = (t) => t.type === "numeric" || t.type === "mcq";
    const placeable = (id: string) => (content.templatesBySkill.get(id) ?? []).some(typeFilter);
    const required = content.skillList.filter((k) => k.domainId === domainId && arch.required[k.id] !== undefined && placeable(k.id));
    if (inDomain.length < 3 && hubId && placeable(hubId)) skill = content.skills.get(hubId);
    else {
      // §7.1.4: the least-attempted required skill whose prerequisites are satisfied.
      const attempted = (id: string) => inDomain.filter((i) => i.skillId === id).length;
      const ok = required.filter((k) => k.prereqIds.every((p) => (states.get(p)?.theta ?? -0.5) >= BAND_PRIORS[2]));
      skill = (ok.length ? ok : required).sort((a, b) => attempted(a.id) - attempted(b.id) || a.tier - b.tier)[0];
    }
    const last = inDomain[inDomain.length - 1];
    const lastBand = (last?.band ?? 1) as Band;
    const lastCorrect = last ? correctById.get(last.id) : undefined;
    band = !last ? 2 : (Math.max(1, Math.min(5, lastBand + (lastCorrect ? 1 : -1))) as Band);
    bucket = "placement";
  } else if (session.mode === "assessment") {
    const doms = requiredDomains(content, arch).filter((d) => d.live);
    const served = items.filter((i) => i.kind === "item");
    const domainId = doms
      .map((d) => ({ d: d.id, deficit: (arch.weights[d.id] ?? 0) * (served.length + 1) - served.filter((i) => content.skills.get(i.skillId)?.domainId === d.id).length }))
      .sort((a, b) => b.deficit - a.deficit)[0]?.d;
    const pool = content.skillList.filter((k) => k.domainId === domainId && arch.required[k.id] !== undefined && content.templatesBySkill.has(k.id) && k.id !== history[history.length - 1]);
    skill = pool[randomInt(0, Math.max(1, pool.length))];
    band = (rand() < 0.5 ? 3 : 4) as Band;
    bucket = "assessment";
  } else if (slot.skillId && content.skills.has(slot.skillId)) {
    // Skill-focused practice (skill page "Practice N items"): the skill is fixed, the band adapts.
    skill = content.skills.get(slot.skillId)!;
  } else {
    const picked = pickSkill(slot.bucket, { content, states, arch, now, weakestDomainId: cfg.plan.weakestDomainId, history, rand });
    if (!picked) return null;
    skill = picked.skill;
    bucket = picked.bucket;
  }
  if (!skill) return null;

  const templates = (content.templatesBySkill.get(skill.id) ?? []).filter(typeFilter);
  if (!templates.length) return null;
  const available = [...new Set(templates.map((t) => t.band))];
  const st = states.get(skill.id);
  const targetBand = band ? ([...available].sort((a, b) => Math.abs(a - band!) - Math.abs(b - band!))[0] as Band) : pickBand(skill, bucket, st, st?.entryBand, available);
  const atBand = templates.filter((t) => t.band === targetBand);
  const usedInSession = new Set(items.map((i) => i.templateId));
  const ordered = [...atBand.filter((t) => !usedInSession.has(t.id)), ...atBand.filter((t) => usedInSession.has(t.id))];

  // §8.3 — prefer an instance the user has not seen in 90 days; keyed on the instance hash, not the seed.
  const since = new Date(now.getTime() - SEEN_WINDOW_DAYS * DAY_MS);
  for (const template of ordered.length ? ordered : templates) {
    const seenRows = await db
      .select({ h: s.responses.instanceHash })
      .from(s.responses)
      .where(and(eq(s.responses.userId, user.id), eq(s.responses.templateId, template.id), gt(s.responses.createdAt, since)));
    const seen = new Set(seenRows.map((r) => r.h));
    for (let tries = 0; tries < 12; tries++) {
      const seed = randomInt(1, 100_000);
      const inst = instanceFor(content, template.id, template.version, seed);
      if (!seen.has(inst.instanceHash)) return { skill, template, seed, inst, seen: false, bucket };
    }
  }
  // Parameter space exhausted everywhere: serve a repeat, which earns no mastery credit.
  const template = (ordered.length ? ordered : templates)[0]!;
  const seed = randomInt(1, 100_000);
  return { skill, template, seed, inst: instanceFor(content, template.id, template.version, seed), seen: true, bucket };
}

async function servedPayload(db: Db, content: Content, session: SessionRow, row: ItemRow, items: ItemRow[], now: Date) {
  const inst = instanceFor(content, row.templateId!, row.templateVersion!, row.seed!);
  const skill = content.skills.get(row.skillId)!;
  const payload = clientPayload(inst);
  const progress = (row.progress ?? {}) as ItemProgress;
  let progressOut: unknown = null;
  if (inst.checkpoints) {
    const results = progress.checkpoints ?? [];
    payload.checkpoints = inst.checkpoints.map((c, index) => ({ index, prompt: c.prompt, kind: c.kind, variables: c.variables, html: renderTex(c.prompt) })).slice(0, results.length + 1);
    progressOut = { checkpoints: results, total: inst.checkpoints.length };
  }
  if (inst.drill) progressOut = { drill: (progress.drill ?? []).map((d) => ({ correct: d.correct })) };
  const cfg = session.config as SessionConfig;
  const responses = await db.select({ sid: s.responses.sessionItemId, correct: s.responses.correct }).from(s.responses).where(eq(s.responses.sessionId, session.id));
  const byId = new Map(responses.map((r) => [r.sid, r.correct]));
  return {
    sessionItemId: row.id,
    mode: session.mode,
    position: row.position,
    total: cfg.plan.slots.length,
    skillId: skill.id,
    skillName: skill.name,
    domainName: skill.domainName,
    seed: row.seed!,
    unseen: !progress.seen,
    servedAt: row.servedAt!.toISOString(),
    now: now.toISOString(),
    status: row.status,
    item: payload,
    progress: progressOut,
    elapsedMs: Math.max(0, Date.now() - row.servedAt!.getTime()),
    history: items.map((i) => ({ status: i.status, ok: byId.get(i.id) ?? null })),
  } satisfies ServedItem;
}

// ── Submitting ──────────────────────────────────────────────────────────────

type ItemProgress = {
  seen?: boolean;
  checkpoints?: { raw: string; correct: boolean; carried: boolean; display: string; answerDisplay: string; misconceptionId: string | null }[];
  drill?: { raw: string; correct: boolean; misconceptionId: string | null; late: boolean }[];
};

export type Verdict = {
  status: "correct" | "incorrect" | "timeout" | "voided" | "recorded";
  mode: string;
  submitted: string | null;
  correctHtml: string;
  misconception: { id: string; label: string; explanationHtml: string } | null;
  review: { skillId: string; stepId: string; stepNumber: number; lessonTitle: string } | null;
  solutionHtml: string[];
  deltas: {
    theta: [number, number];
    coldStreak: [number, number];
    b: [number, number];
    level: [number, number];
  } | null;
  elapsedMs: number;
  timeLimitSec: number;
  partial?: { correct: number; total: number };
  /** assessment: solutions come after the whole test */
  withheld?: boolean;
};

/** Claim semantics (tech spec §8): one row → we own it; otherwise explain why not. */
async function claim(db: Db, itemId: string, userId: string): Promise<{ row: ItemRow; elapsedMs: number } | { cached: ItemRow }> {
  const rows = await db.execute<{ id: string; elapsed_ms: number }>(sql`
    update session_items
       set status = 'grading',
           submitted_at = now(),
           elapsed_ms = (extract(epoch from (now() - served_at)) * 1000)::int
     where id = ${itemId} and user_id = ${userId} and status = 'served' and kind = 'item'
     returning id, elapsed_ms`);
  const [row] = await db.select().from(s.sessionItems).where(and(eq(s.sessionItems.id, itemId), eq(s.sessionItems.userId, userId)));
  if (!row) throw new AppError("NOT_FOUND", "item");
  if (rows.length === 1) return { row, elapsedMs: Number(rows[0]!.elapsed_ms) };
  if (row.status === "grading") throw new AppError("ITEM_GRADING", "already being graded");
  if (row.verdict) return { cached: row };
  throw new AppError("ITEM_NOT_OPEN", `item is ${row.status}`);
}

/** A validation error (not a number, not an expression) releases the claim: it was never a submission. */
async function release(db: Db, itemId: string) {
  await db.update(s.sessionItems).set({ status: "served", submittedAt: null, elapsedMs: null }).where(and(eq(s.sessionItems.id, itemId), eq(s.sessionItems.status, "grading")));
}

async function elapsedNow(db: Db, itemId: string): Promise<number> {
  const rows = await db.execute<{ e: number }>(sql`select (extract(epoch from (now() - served_at)) * 1000)::int as e from session_items where id = ${itemId}`);
  return Number(rows[0]?.e ?? 0);
}

export async function submitAnswer(itemId: string, userId: string, raw: string, clientElapsedMs: number | null) {
  const db = getDb();
  await rateLimit("answer", userId);
  const c = await claim(db, itemId, userId);
  if ("cached" in c) return presentVerdict(c.cached.verdict as Verdict);
  const { row, elapsedMs } = c;
  const content = await getContent();
  const inst = instanceFor(content, row.templateId!, row.templateVersion!, row.seed!);

  // Multi-step and drill items finish through their own path; /answer on them means "stop now".
  if (inst.type === "multistep" || inst.type === "drill") {
    await release(db, itemId);
    return finishStepped(itemId, userId, true);
  }

  const timedOut = elapsedMs > inst.timeLimitSec * 1000 + TIMEOUT_GRACE_MS;
  let graded: Graded;
  try {
    graded = timedOut ? { kind: "graded", correct: false, misconceptionId: null, display: raw.trim() || "—" } : await gradeMain(inst, raw);
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_A_NUMBER" || e.code === "PARSE_ERROR" || e.code === "VALIDATION")) await release(db, itemId);
    else await voidItem(db, row, inst, "grading error");
    throw e;
  }
  if (graded.kind === "void") return presentVerdict(await voidItem(db, row, inst, graded.reason));

  const verdict = await record(db, content, row, inst, {
    y: graded.correct ? 1 : 0,
    correct: graded.correct,
    timedOut,
    elapsedMs,
    clientElapsedMs,
    submittedRaw: raw,
    submittedDisplay: graded.display,
    misconceptionId: graded.misconceptionId,
  });
  return presentVerdict(verdict);
}

/** Multi-step checkpoint or drill sub-item (tech spec §8 /step). */
export async function submitStep(itemId: string, userId: string, index: number, raw: string) {
  const db = getDb();
  await rateLimit("answer", userId);
  const content = await getContent();
  const [row] = await db.select().from(s.sessionItems).where(and(eq(s.sessionItems.id, itemId), eq(s.sessionItems.userId, userId)));
  if (!row) throw new AppError("NOT_FOUND", "item");
  if (row.status !== "served") {
    if (row.verdict) return { done: true as const, verdict: presentVerdict(row.verdict as Verdict) };
    throw new AppError("ITEM_NOT_OPEN");
  }
  const inst = instanceFor(content, row.templateId!, row.templateVersion!, row.seed!);
  const progress = (row.progress ?? {}) as ItemProgress;
  const elapsed = await elapsedNow(db, itemId);
  const over = elapsed > inst.timeLimitSec * 1000 + TIMEOUT_GRACE_MS;

  if (inst.drill) {
    const answers = progress.drill ?? [];
    if (index !== answers.length || index >= inst.drill.items.length) throw new AppError("CONFLICT", "drill items are answered in order");
    // Answers after the buzzer are discarded, not marked wrong (§8.4).
    const g = over ? { correct: false, misconceptionId: null } : gradeDrillItem(inst.drill.items[index]!, raw);
    const next = [...answers, { raw, correct: g.correct, misconceptionId: g.misconceptionId, late: over }];
    const updated = await db
      .update(s.sessionItems)
      .set({ progress: { ...progress, drill: next } })
      .where(and(eq(s.sessionItems.id, itemId), eq(s.sessionItems.status, "served"), sql`coalesce(jsonb_array_length(${s.sessionItems.progress}->'drill'), 0) = ${index}`))
      .returning({ id: s.sessionItems.id });
    if (!updated.length) throw new AppError("CONFLICT", "that drill item was already answered");
    if (over || next.length === inst.drill.items.length) return { done: true as const, verdict: await finishStepped(itemId, userId, false) };
    return { done: false as const, index, correct: g.correct, answered: next.length, correctCount: next.filter((x) => x.correct && !x.late).length };
  }

  if (!inst.checkpoints) throw new AppError("VALIDATION", "not a stepped item");
  const results = progress.checkpoints ?? [];
  if (index !== results.length || index >= inst.checkpoints.length) throw new AppError("CONFLICT", "checkpoints are answered in order");
  if (over) return { done: true as const, verdict: await finishStepped(itemId, userId, true) };
  const cp = inst.checkpoints[index]!;
  const g = await gradeCheckpoint(cp, raw); // NOT_A_NUMBER / PARSE_ERROR propagate: not a submission
  if (g.kind === "void") return { done: true as const, verdict: presentVerdict(await voidItem(db, row, inst, g.reason)) };
  const entry = { raw, correct: g.correct, carried: !g.correct, display: g.display, answerDisplay: cp.display, misconceptionId: g.misconceptionId };
  const next = [...results, entry];
  const updated = await db
    .update(s.sessionItems)
    .set({ progress: { ...progress, checkpoints: next } })
    .where(and(eq(s.sessionItems.id, itemId), eq(s.sessionItems.status, "served"), sql`coalesce(jsonb_array_length(${s.sessionItems.progress}->'checkpoints'), 0) = ${index}`))
    .returning({ id: s.sessionItems.id });
  if (!updated.length) throw new AppError("CONFLICT", "that checkpoint was already answered");
  if (next.length === inst.checkpoints.length) return { done: true as const, verdict: await finishStepped(itemId, userId, false) };
  return {
    done: false as const,
    index,
    correct: g.correct,
    // A wrong checkpoint reveals its correct value and the item carries on (§8.1.1).
    reveal: g.correct ? null : { answerHtml: renderTex(cp.display), yours: g.display },
    next: checkpointPayload(inst, index + 1),
  };
}

/** Score a multi-step or drill item from its recorded progress. */
async function finishStepped(itemId: string, userId: string, stoppedEarly: boolean): Promise<Verdict> {
  const db = getDb();
  const c = await claim(db, itemId, userId);
  if ("cached" in c) return presentVerdict(c.cached.verdict as Verdict);
  const { row, elapsedMs } = c;
  const content = await getContent();
  const inst = instanceFor(content, row.templateId!, row.templateVersion!, row.seed!);
  const progress = (row.progress ?? {}) as ItemProgress;
  const timedOut = elapsedMs > inst.timeLimitSec * 1000 + TIMEOUT_GRACE_MS;

  if (inst.drill) {
    const N = inst.drill.items.length;
    const k = (progress.drill ?? []).filter((d) => d.correct && !d.late).length;
    const y = k / N;
    const correct = y >= inst.drill.passFraction;
    const mis = (progress.drill ?? []).find((d) => d.misconceptionId)?.misconceptionId ?? null;
    return presentVerdict(
      await record(db, content, row, inst, { y, correct, timedOut: false, withinLimitOverride: true, elapsedMs, clientElapsedMs: null, submittedRaw: JSON.stringify((progress.drill ?? []).map((d) => d.raw)), submittedDisplay: `${k} of ${N}`, misconceptionId: mis, setSize: N, partial: { correct: k, total: N } }),
    );
  }
  const total = inst.checkpoints!.length;
  const results = progress.checkpoints ?? [];
  const k = results.filter((r) => r.correct).length;
  // Partial credit to θ; all-or-nothing for mastery (§8.1.1). Unanswered checkpoints count as wrong.
  const allCorrect = k === total && !stoppedEarly;
  return presentVerdict(
    await record(db, content, row, inst, {
      y: timedOut ? 0 : k / total,
      correct: allCorrect && !timedOut,
      timedOut,
      elapsedMs,
      clientElapsedMs: null,
      submittedRaw: JSON.stringify(results.map((r) => r.raw)),
      submittedDisplay: `${k} of ${total} steps`,
      misconceptionId: results.find((r) => r.misconceptionId)?.misconceptionId ?? null,
      partial: { correct: k, total },
    }),
  );
}

type RecordInput = {
  y: number;
  correct: boolean;
  timedOut: boolean;
  elapsedMs: number;
  clientElapsedMs: number | null;
  submittedRaw: string;
  submittedDisplay: string;
  misconceptionId: string | null;
  setSize?: number;
  partial?: { correct: number; total: number };
  withinLimitOverride?: boolean;
};

/** Step 3: one transaction — append the response, update skill states, item difficulty and the item row. */
async function record(db: Db, content: Content, row: ItemRow, inst: Instance, r: RecordInput): Promise<Verdict> {
  const [session] = await db.select().from(s.sessions).where(eq(s.sessions.id, row.sessionId));
  const mode = session!.mode === "placement" ? "placement" : session!.mode === "assessment" ? "assessment" : "practice";
  const user = await getUser(db, row.userId!);
  const skill = content.skills.get(row.skillId)!;
  const withinLimit = r.withinLimitOverride ?? r.elapsedMs <= inst.timeLimitSec * 1000 + TIMEOUT_GRACE_MS;

  const verdict = await db.transaction(async (tx) => {
    const now = new Date();
    const [stats] = await tx
      .select()
      .from(s.itemStats)
      .where(and(eq(s.itemStats.templateId, inst.templateId), eq(s.itemStats.version, inst.version)))
      .for("update");
    const b = stats?.b ?? BAND_PRIORS[inst.band];
    const itemResponseCount = stats?.responses ?? 0;
    const since = new Date(now.getTime() - SEEN_WINDOW_DAYS * DAY_MS);
    const [seenRow] = await tx
      .select({ id: s.responses.id })
      .from(s.responses)
      .where(and(eq(s.responses.userId, user.id), eq(s.responses.templateId, inst.templateId), eq(s.responses.instanceHash, inst.instanceHash), gt(s.responses.createdAt, since), isNull(s.responses.voidedAt)))
      .limit(1);
    const seenBefore = !!seenRow;

    const touched = [skill.id, ...skill.prereqIds];
    const states = await loadStates(tx as unknown as Db, user.id, touched);
    const beforeStates = new Map(states);
    const outcome: Outcome = {
      y: r.y,
      correct: r.correct,
      band: inst.band,
      b,
      timedOut: r.timedOut,
      withinLimit,
      seenBefore,
      itemResponseCount,
      mode,
      misconceptionId: r.misconceptionId,
      ...(r.setSize ? { setSize: r.setSize } : {}),
    };
    const scoring = new Map<string, SkillState>(states);
    const { delta } = applyToUser(scoring, content.skills, { skillId: skill.id, outcome, at: now });
    const interview = interviewDateOf(user);
    for (const id of touched) {
      const st = scoring.get(id);
      if (st && (st !== beforeStates.get(id) || !beforeStates.has(id))) await saveState(tx as unknown as Db, user.id, id, st, now, interview);
    }
    const timingFlag = r.clientElapsedMs !== null && Math.abs(r.clientElapsedMs - r.elapsedMs) > 3000;
    await tx.insert(s.responses).values({
      sessionItemId: row.id,
      sessionId: row.sessionId,
      userId: user.id,
      skillId: skill.id,
      templateId: inst.templateId,
      templateVersion: inst.version,
      seed: inst.seed,
      instanceHash: inst.instanceHash,
      band: inst.band,
      type: inst.type,
      submittedRaw: r.submittedRaw.slice(0, 2000),
      y: r.y,
      correct: r.correct,
      timedOut: r.timedOut,
      withinLimit,
      seenBefore,
      elapsedMs: r.elapsedMs,
      clientElapsedMs: r.clientElapsedMs,
      timingFlag,
      pPred: delta.p,
      thetaBefore: delta.thetaBefore,
      thetaAfter: delta.thetaAfter,
      bBefore: delta.bBefore,
      bAfter: delta.bAfter,
      levelBefore: delta.levelBefore,
      levelAfter: delta.levelAfter,
      itemResponseCount,
      setSize: r.setSize ?? null,
      misconceptionId: r.misconceptionId,
      mode,
      createdAt: now,
    });
    await tx
      .insert(s.itemStats)
      .values({ templateId: inst.templateId, version: inst.version, responses: 1, correct: r.correct ? 1 : 0, totalElapsedMs: r.elapsedMs, b: delta.bAfter })
      .onConflictDoUpdate({
        target: [s.itemStats.templateId, s.itemStats.version],
        set: {
          responses: sql`${s.itemStats.responses} + 1`,
          correct: sql`${s.itemStats.correct} + ${r.correct ? 1 : 0}`,
          totalElapsedMs: sql`${s.itemStats.totalElapsedMs} + ${r.elapsedMs}`,
          b: delta.bAfter,
          updatedAt: now,
        },
      });

    // §19.4 — remediation runs inside the submit transaction, after scoring.
    if (mode === "practice") {
      const after = scoring.get(skill.id)!;
      const cause = shouldRemediate(after.recent, delta.levelAfter < delta.levelBefore);
      if (cause && content.lessons.has(skill.id)) {
        const [existing] = await tx.select({ id: s.remediation.id }).from(s.remediation).where(and(eq(s.remediation.userId, user.id), eq(s.remediation.skillId, skill.id), isNull(s.remediation.resolvedAt)));
        if (!existing) {
          await tx.insert(s.remediation).values({ userId: user.id, skillId: skill.id, cause: cause.cause, misconceptionId: cause.misconceptionId });
          await events.emit("refresher_triggered", user.id, { skill: skill.id, cause: cause.cause });
        }
      }
    }

    const mis = r.misconceptionId ? content.misconceptions.get(r.misconceptionId) : undefined;
    const lesson = content.lessons.get(skill.id);
    const stepId = mis && lesson ? stepForMisconception(lesson, mis.id) : null;
    const v: Verdict = {
      status: r.timedOut ? "timeout" : r.correct ? "correct" : "incorrect",
      mode,
      submitted: r.submittedDisplay,
      correctHtml: answerHtml(inst),
      misconception: mis ? { id: mis.id, label: mis.label, explanationHtml: renderTex(mis.explanation) } : null,
      review: stepId && lesson ? { skillId: skill.id, stepId, stepNumber: lesson.steps.findIndex((x) => x.id === stepId) + 1, lessonTitle: lesson.title } : null,
      solutionHtml: solutionHtml(inst),
      deltas: {
        theta: [delta.thetaBefore, delta.thetaAfter],
        coldStreak: [delta.coldStreakBefore, delta.coldStreakAfter],
        b: [delta.bBefore, delta.bAfter],
        level: [delta.levelBefore, delta.levelAfter],
      },
      elapsedMs: r.elapsedMs,
      timeLimitSec: inst.timeLimitSec,
      ...(r.partial ? { partial: r.partial } : {}),
    };
    await tx
      .update(s.sessionItems)
      .set({ status: r.timedOut ? "timed_out" : "answered", verdict: v })
      .where(eq(s.sessionItems.id, row.id));
    return { v, delta };
  });

  await events.emit("item_answered", user.id, { correct: r.correct, elapsed_ms: r.elapsedMs, timed_out: r.timedOut, band: inst.band, type: inst.type, predicted_p: verdict.delta.p });
  if (verdict.delta.levelAfter !== verdict.delta.levelBefore) {
    await events.emit("level_changed", user.id, { skill: skill.id, from: verdict.delta.levelBefore, to: verdict.delta.levelAfter, cause: "response" });
  }
  if (mode === "placement") await events.emit("placement_item_answered", user.id, { index: row.position, band: inst.band, correct: r.correct });
  return verdict.v;
}

/** Grader failure: the item is voided, θ untouched, and it goes back into the queue (§8.1.3). */
async function voidItem(db: Db, row: ItemRow, inst: Instance, reason: string): Promise<Verdict> {
  const v: Verdict = {
    status: "voided",
    mode: "practice",
    submitted: null,
    correctHtml: "",
    misconception: null,
    review: null,
    solutionHtml: [],
    deltas: null,
    elapsedMs: row.elapsedMs ?? 0,
    timeLimitSec: inst.timeLimitSec,
  };
  await db.transaction(async (tx) => {
    await tx.update(s.sessionItems).set({ status: "ungraded", verdict: v }).where(eq(s.sessionItems.id, row.id));
    const [session] = await tx.select().from(s.sessions).where(eq(s.sessions.id, row.sessionId)).for("update");
    const cfg = session!.config as SessionConfig;
    cfg.plan.slots.push({ kind: "item", bucket: (row.bucket as Bucket) ?? "new" });
    if (cfg.placementDomains) cfg.placementDomains.push(cfg.placementDomains[row.position] ?? cfg.placementDomains[0]!);
    await tx.update(s.sessions).set({ config: cfg }).where(eq(s.sessions.id, row.sessionId));
    await tx
      .insert(s.itemStats)
      .values({ templateId: inst.templateId, version: inst.version, voidCount: 1, b: BAND_PRIORS[inst.band] })
      .onConflictDoUpdate({ target: [s.itemStats.templateId, s.itemStats.version], set: { voidCount: sql`${s.itemStats.voidCount} + 1` } });
  });
  await events.emit("item_voided", row.userId, { template: inst.templateId, cause: reason });
  return v;
}

/** In assessment mode solutions (and correctness) come after the whole test (§10.4). */
function presentVerdict(v: Verdict): Verdict {
  if (v.mode !== "assessment" || v.status === "voided") return v;
  return { ...v, status: "recorded", withheld: true, correctHtml: "", misconception: null, review: null, solutionHtml: [], deltas: null };
}

// ── Abandonment and ending ──────────────────────────────────────────────────

/** Score an abandoned item as a timeout (§9.4). Used at session close and by the sweeper. */
export async function resolveAbandoned(itemId: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(s.sessionItems).where(eq(s.sessionItems.id, itemId));
  if (!row || row.kind !== "item") return;
  if (row.status === "grading") {
    // A process died mid-grade: never let that cost the user.
    const content = await getContent();
    await voidItem(db, row, instanceFor(content, row.templateId!, row.templateVersion!, row.seed!), "stuck in grading");
    return;
  }
  const claimed = await db.execute<{ elapsed_ms: number }>(sql`
    update session_items set status = 'grading', submitted_at = now(),
           elapsed_ms = (extract(epoch from (now() - served_at)) * 1000)::int
     where id = ${itemId} and status = 'served' returning elapsed_ms`);
  if (!claimed.length) return;
  const content = await getContent();
  const [fresh] = await db.select().from(s.sessionItems).where(eq(s.sessionItems.id, itemId));
  const inst = instanceFor(content, fresh!.templateId!, fresh!.templateVersion!, fresh!.seed!);
  await record(db, content, fresh!, inst, {
    y: 0,
    correct: false,
    timedOut: true,
    elapsedMs: Number(claimed[0]!.elapsed_ms),
    clientElapsedMs: null,
    submittedRaw: "",
    submittedDisplay: "—",
    misconceptionId: null,
  });
}

export async function sweepAbandoned(now = new Date()): Promise<number> {
  const db = getDb();
  const content = await getContent();
  const open = await db.select().from(s.sessionItems).where(inArray(s.sessionItems.status, ["served", "grading"]));
  let n = 0;
  for (const it of open) {
    if (!it.servedAt || it.kind !== "item") continue;
    const tpl = content.templateByKey.get(`${it.templateId}@${it.templateVersion}`);
    const limitMs = (tpl?.timeLimitSec ?? 600) * 1000;
    const stuckGrading = it.status === "grading" && now.getTime() - (it.submittedAt?.getTime() ?? it.servedAt.getTime()) > 60_000;
    if (stuckGrading || (it.status === "served" && now.getTime() - it.servedAt.getTime() > limitMs + ABANDON_AFTER_LIMIT_MS)) {
      await resolveAbandoned(it.id);
      n++;
    }
  }
  return n;
}

export async function flagItem(itemId: string, userId: string, note: string | null) {
  const db = getDb();
  await rateLimit("flag", userId);
  const [row] = await db.select().from(s.sessionItems).where(and(eq(s.sessionItems.id, itemId), eq(s.sessionItems.userId, userId)));
  if (!row || !row.templateId) throw new AppError("NOT_FOUND", "item");
  await db.insert(s.flags).values({ userId, targetType: "item", sessionItemId: row.id, templateId: row.templateId, version: row.templateVersion, seed: row.seed, note: note?.slice(0, 2000) ?? null });
  await db
    .update(s.itemStats)
    .set({ flagCount: sql`${s.itemStats.flagCount} + 1` })
    .where(and(eq(s.itemStats.templateId, row.templateId), eq(s.itemStats.version, row.templateVersion!)));
  await events.emit("item_flagged", userId, { template: row.templateId, version: row.templateVersion, reason: note ? "note" : "none" });
  return { ok: true };
}

