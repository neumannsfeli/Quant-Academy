/**
 * Product spec §10 — session composition.
 *
 * The plan fixes the *shape* of a session up front (a lesson, refreshers, and how
 * many items go to reviews, the weakest link and new material); the concrete skill,
 * band, template and seed are chosen when each item is served. That keeps the
 * prerequisite gate honest as levels change mid-session, and lets interleaving see
 * what was actually served.
 */
import {
  LESSON_LED_UNTIL_FAMILIAR_SHARE,
  MAX_CONSECUTIVE_SAME_DOMAIN,
  MEDIAN_FALLBACK_SHARE_OF_LIMIT,
  REVIEW_THRESHOLD,
  SESSION_REVIEW_SHARE,
  SESSION_REVIEW_SHARE_BACKLOG,
  SESSION_WEAKEST_SHARE,
  TARGET_P,
  bandForTargetP,
  retention,
  type Band,
  type SkillState,
} from "@qa/scoring";
import type { ArchetypeInfo, Content, SkillInfo, TemplateRow } from "./content";
import { learnUnlocked, practiceUnlocked } from "./status";

export type Bucket = "review" | "weakest" | "new" | "lesson" | "refresher" | "placement" | "assessment";
export type Slot = { kind: "item" | "lesson" | "refresher"; bucket: Bucket; skillId?: string; misconceptionId?: string | null };

export type Plan = {
  slots: Slot[];
  minutes: number;
  items: number;
  counts: { lessons: number; refreshers: number; review: number; weakest: number; new: number };
  lessonSkillId: string | null;
  reviewsDue: number;
  weakestDomainId: string | null;
};

export type ComposeInput = {
  content: Content;
  states: Map<string, SkillState>;
  arch: ArchetypeInfo;
  now: Date;
  minutes: number;
  weakestDomainId: string | null;
  openRemediation: { skillId: string; misconceptionId: string | null }[];
  /** skills whose learning path is completed or skipped */
  lessonsDone: Set<string>;
  /** observed median solve seconds per template id, where there are ≥ 30 responses */
  medianSec: Map<string, number>;
};

const REFRESHER_MINUTES = 5;

export function templateMinutes(t: TemplateRow, medianSec: Map<string, number>): number {
  const sec = medianSec.get(t.id) ?? t.timeLimitSec * MEDIAN_FALLBACK_SHARE_OF_LIMIT;
  return sec / 60;
}

function liveRequired(content: Content, arch: ArchetypeInfo): SkillInfo[] {
  return content.skillList.filter((k) => content.domainById.get(k.domainId)?.live && arch.required[k.id] !== undefined);
}

/** §10.1 lesson bucket: the topologically-first unlearned, learn-unlocked skill with a lesson. */
export function lessonCandidate(input: Pick<ComposeInput, "content" | "states" | "arch" | "weakestDomainId" | "lessonsDone">): SkillInfo | null {
  const { content, states, arch, weakestDomainId, lessonsDone } = input;
  const required = liveRequired(content, arch);
  const eligible = (k: SkillInfo) =>
    content.lessons.has(k.id) && !lessonsDone.has(k.id) && (states.get(k.id)?.level ?? 0) < 1 && learnUnlocked(k, states);
  const familiarShare = required.length ? required.filter((k) => (states.get(k.id)?.level ?? 0) >= 1).length / required.length : 1;
  const byTier = (a: SkillInfo, b: SkillInfo) => a.tier - b.tier || b.importance - a.importance;
  const inWeakest = required.filter((k) => k.domainId === weakestDomainId && eligible(k)).sort(byTier)[0];
  if (inWeakest) return inWeakest;
  if (familiarShare >= LESSON_LED_UNTIL_FAMILIAR_SHARE) return null;
  const domainsByWeight = Object.entries(arch.weights).sort((a, b) => b[1] - a[1]).map(([d]) => d);
  for (const d of domainsByWeight) {
    const k = required.filter((x) => x.domainId === d && eligible(x)).sort(byTier)[0];
    if (k) return k;
  }
  return null;
}

export function dueReviews(content: Content, states: Map<string, SkillState>, arch: ArchetypeInfo, now: Date): SkillInfo[] {
  return content.skillList
    .filter((k) => {
      const st = states.get(k.id);
      if (!st || !content.domainById.get(k.domainId)?.live || !content.templatesBySkill.has(k.id)) return false;
      const r = retention(st, now);
      return r !== null && r < REVIEW_THRESHOLD && practiceUnlocked(k, states);
    })
    .sort((a, b) => reviewPriority(b, states, arch, now) - reviewPriority(a, states, arch, now));
}

/** §10.1: ordered by 0.85 − r, weighted by domain weight × importance. */
function reviewPriority(k: SkillInfo, states: Map<string, SkillState>, arch: ArchetypeInfo, now: Date): number {
  const r = retention(states.get(k.id)!, now) ?? 1;
  return (REVIEW_THRESHOLD - r) * ((arch.weights[k.domainId] ?? 0.05) * k.importance);
}

export function composePlan(input: ComposeInput): Plan {
  const { content, states, arch, now, minutes, openRemediation } = input;
  const slots: Slot[] = [];
  let budget = minutes;

  const lesson = lessonCandidate(input);
  if (lesson) {
    slots.push({ kind: "lesson", bucket: "lesson", skillId: lesson.id });
    budget -= content.lessons.get(lesson.id)!.est_minutes;
  }
  const refreshers = openRemediation.filter((r) => content.lessons.has(r.skillId)).slice(0, 2);
  for (const r of refreshers) {
    slots.push({ kind: "refresher", bucket: "refresher", skillId: r.skillId, misconceptionId: r.misconceptionId });
    budget -= REFRESHER_MINUTES;
  }

  // Size the practice block in minutes from median solve times (§10.3.4), not item limits.
  const unlocked = content.skillList.filter((k) => content.templatesBySkill.has(k.id) && practiceUnlocked(k, states) && content.domainById.get(k.domainId)?.live);
  const pool = unlocked.flatMap((k) => content.templatesBySkill.get(k.id)!);
  const avgMinutes = pool.length ? pool.reduce((s, t) => s + templateMinutes(t, input.medianSec), 0) / pool.length : 3;
  const items = unlocked.length ? Math.max(lesson ? 3 : 6, Math.floor(Math.max(0, budget) / Math.max(0.5, avgMinutes))) : 0;

  const due = dueReviews(content, states, arch, now);
  const reviewCap = Math.floor(items * (due.length > 2 * items ? SESSION_REVIEW_SHARE_BACKLOG : SESSION_REVIEW_SHARE));
  const review = Math.min(due.length, reviewCap);
  const weakestPool = unlocked.filter((k) => k.domainId === input.weakestDomainId && (states.get(k.id)?.level ?? 0) < 3);
  const weakest = weakestPool.length ? Math.min(Math.round(items * SESSION_WEAKEST_SHARE), items - review) : 0;
  const fresh = Math.max(0, items - review - weakest);

  // Interleave the buckets so reviews do not all land at the start.
  const queue: Bucket[] = [];
  const counts = { review, weakest, new: fresh };
  const total = review + weakest + fresh;
  for (let i = 0; i < total; i++) {
    const want = (["review", "weakest", "new"] as const)
      .map((b) => ({ b, deficit: counts[b] / total * (i + 1) - queue.filter((q) => q === b).length }))
      .sort((x, y) => y.deficit - x.deficit)[0]!.b;
    queue.push(want);
  }
  for (const b of queue) slots.push({ kind: "item", bucket: b });

  return {
    slots,
    minutes,
    items: total,
    counts: { lessons: lesson ? 1 : 0, refreshers: refreshers.length, review, weakest, new: fresh },
    lessonSkillId: lesson?.id ?? null,
    reviewsDue: due.length,
    weakestDomainId: input.weakestDomainId,
  };
}

// ── Serve-time choice ────────────────────────────────────────────────────────

export type PickContext = {
  content: Content;
  states: Map<string, SkillState>;
  arch: ArchetypeInfo;
  now: Date;
  weakestDomainId: string | null;
  /** skills served so far in this session, most recent last */
  history: string[];
  rand: () => number;
};

/** §10.3.2 — no two consecutive items from one skill, no more than three in a row from one domain. */
function interleaveOk(k: SkillInfo, ctx: PickContext): boolean {
  const last = ctx.history[ctx.history.length - 1];
  if (last === k.id) return false;
  const tail = ctx.history.slice(-MAX_CONSECUTIVE_SAME_DOMAIN).map((id) => ctx.content.skills.get(id)?.domainId);
  if (tail.length === MAX_CONSECUTIVE_SAME_DOMAIN && tail.every((d) => d === k.domainId)) return false;
  return true;
}

function servable(k: SkillInfo, ctx: PickContext): boolean {
  return !!ctx.content.domainById.get(k.domainId)?.live && ctx.content.templatesBySkill.has(k.id) && practiceUnlocked(k, ctx.states);
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rand: () => number): T | undefined {
  const ws = items.map(weight);
  const total = ws.reduce((a, b) => a + b, 0);
  if (!items.length || total <= 0) return items[0];
  let x = rand() * total;
  for (let i = 0; i < items.length; i++) {
    x -= ws[i]!;
    if (x <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function pickSkill(bucket: Bucket, ctx: PickContext): { skill: SkillInfo; bucket: Bucket } | null {
  const { content, states, arch, now } = ctx;
  const candidates = content.skillList.filter((k) => servable(k, ctx));
  const ok = candidates.filter((k) => interleaveOk(k, ctx));
  const pool = ok.length ? ok : candidates; // interleaving yields to an empty queue

  if (bucket === "review") {
    const due = dueReviews(content, states, arch, now).filter((k) => pool.includes(k));
    if (due[0]) return { skill: due[0], bucket };
    return pickSkill("new", ctx);
  }
  if (bucket === "weakest") {
    const weak = pool
      .filter((k) => k.domainId === ctx.weakestDomainId && (states.get(k.id)?.level ?? 0) < 3)
      .sort((a, b) => (states.get(a.id)?.theta ?? -0.5) - (states.get(b.id)?.theta ?? -0.5));
    if (weak.length) return { skill: weightedPick(weak.slice(0, 3), () => 1, ctx.rand)!, bucket };
    return pickSkill("new", ctx);
  }
  // New / advancing: prefer required skills not yet proven cold, lower levels first.
  const advancing = pool.filter((k) => (states.get(k.id)?.level ?? 0) < 3);
  const choice = advancing.length ? advancing : pool;
  const skill = weightedPick(
    choice,
    (k) => (arch.required[k.id] !== undefined ? 3 : 1) * (4 - (states.get(k.id)?.level ?? 0)) * (arch.weights[k.domainId] ?? 0.1),
    ctx.rand,
  );
  return skill ? { skill, bucket: "new" } : null;
}

/** §10.2 — band selection. */
export function pickBand(skill: SkillInfo, bucket: Bucket, state: SkillState | undefined, entryBand: Band | null | undefined, available: Band[]): Band {
  let want: Band;
  if (bucket === "review" && state?.lastPassedBand) want = state.lastPassedBand;
  else if (state && state.level >= 2) want = Math.max(3, bandForTargetP(state.theta, TARGET_P)) as Band; // Level-3 attempts: band ≥ 3, forced
  else if (entryBand && (state?.levelAttempts ?? 0) === 0) want = entryBand;
  else want = bandForTargetP(state?.theta ?? -0.5, TARGET_P);
  if (bucket === "assessment") want = Math.max(3, Math.min(4, want)) as Band;
  // Nearest band the library actually has; ties go to the harder one when proving cold.
  return [...available].sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || (state && state.level >= 2 ? b - a : a - b))[0] ?? want;
}
