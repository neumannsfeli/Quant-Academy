import {
  BAND_PRIORS,
  CONFIDENCE_FULL,
  CONFIDENCE_SEEN,
  CONFIDENCE_UNCALIBRATED,
  DAY_MS,
  DRILL_KU_SET_SIZE,
  INFERRED_FAST_ATTEMPTS,
  KI_SCHEDULE,
  KU_PLACEMENT,
  KU_SCHEDULE,
  LEVEL2_DEMOTION_FAILURES,
  LEVEL2_MIN_ATTEMPTS,
  LEVEL2_MIN_RECENT_RATE,
  LEVEL2_MIN_THETA,
  LEVEL2_RECENT_WINDOW,
  LEVEL3_MIN_BAND,
  LEVEL3_MIN_RETENTION,
  LEVEL3_STREAK,
  PREREQ_PROPAGATION,
  RECALIBRATION_GAP,
  RECALIBRATION_SHRINK,
  REVIEW_THRESHOLD,
  S0_DAYS,
  S_FAIL_MULT,
  S_MAX_DAYS,
  S_MIN_DAYS,
  S_PASS_MULT,
  S_SLOW_PASS_MULT,
  SKIP_PRIOR_THETA,
  THETA_BOUND,
  UNCALIBRATED_BELOW_RESPONSES,
} from "./constants";
import type { Band, Delta, Level, Outcome, RecentOutcome, SkillState } from "./types";

export const RECENT_CAP = 10;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const finiteOr = (x: number, fallback: number) => (Number.isFinite(x) ? x : fallback);

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** §3.1 — probability of a correct answer. */
export function predictP(theta: number, b: number): number {
  return sigmoid(finiteOr(theta, 0) - finiteOr(b, 0));
}

export function bandPrior(band: Band): number {
  return BAND_PRIORS[band];
}

export function initialSkillState(theta: number = SKIP_PRIOR_THETA): SkillState {
  return {
    theta,
    level: 0,
    coldStreak: 0,
    stabilityS: S0_DAYS,
    lastCorrectAt: null,
    attempts: 0,
    levelAttempts: 0,
    inferred: false,
    lastPassedBand: null,
    recent: [],
  };
}

function scheduleRate(schedule: readonly { below: number; k: number }[], n: number): number {
  for (const step of schedule) if (n < step.below) return step.k;
  return schedule[schedule.length - 1]!.k;
}

/** §3.2 Kᵤ for this state and outcome, including the placement, inferred and drill rules. */
export function userRate(state: SkillState, outcome: Pick<Outcome, "mode" | "setSize">): number {
  let k: number;
  if (outcome.mode === "placement") k = KU_PLACEMENT;
  else if (state.inferred && state.attempts < INFERRED_FAST_ATTEMPTS) k = KU_PLACEMENT;
  else k = scheduleRate(KU_SCHEDULE, state.attempts);
  if (outcome.setSize !== undefined && outcome.setSize > 0) {
    k *= Math.min(1, outcome.setSize / DRILL_KU_SET_SIZE);
  }
  return k;
}

/** §3.2 Kᵢ by responses to the template. */
export function itemRate(itemResponseCount: number): number {
  return scheduleRate(KI_SCHEDULE, Math.max(0, itemResponseCount));
}

/** §3.2 confidence multiplier c. A repeated instance is the weakest evidence, so it wins. */
export function confidence(outcome: Pick<Outcome, "seenBefore" | "itemResponseCount">): number {
  if (outcome.seenBefore) return CONFIDENCE_SEEN;
  if (outcome.itemResponseCount < UNCALIBRATED_BELOW_RESPONSES) return CONFIDENCE_UNCALIBRATED;
  return CONFIDENCE_FULL;
}

/** §4.1 — predicted retention at `now`; null if the skill has never been answered correctly. */
export function retention(
  state: Pick<SkillState, "lastCorrectAt" | "stabilityS">,
  now: Date,
): number | null {
  if (!state.lastCorrectAt) return null;
  const tDays = Math.max(0, (now.getTime() - state.lastCorrectAt.getTime()) / DAY_MS);
  const s = clamp(state.stabilityS, S_MIN_DAYS, S_MAX_DAYS);
  return Math.exp(-tDays / s);
}

/** §4.3 — days after the last success at which r crosses the review threshold. */
export function reviewIntervalDays(stabilityS: number): number {
  return -clamp(stabilityS, S_MIN_DAYS, S_MAX_DAYS) * Math.log(REVIEW_THRESHOLD);
}

/**
 * §4.3–4.4 — when the skill next enters the review queue. Null when the skill
 * has never been answered correctly: there is nothing to retain yet.
 */
export function nextDueAt(
  state: Pick<SkillState, "lastCorrectAt" | "stabilityS">,
  now: Date,
  interviewDate?: Date | null,
): Date | null {
  if (!state.lastCorrectAt) return null;
  let interval = reviewIntervalDays(state.stabilityS);
  if (interviewDate) {
    const daysUntil = (interviewDate.getTime() - now.getTime()) / DAY_MS;
    if (daysUntil > 0) interval = Math.min(interval, Math.max(1, daysUntil / 2));
  }
  return new Date(state.lastCorrectAt.getTime() + interval * DAY_MS);
}

/** §4.2 — the stability update. */
export function nextStability(state: SkillState, outcome: Outcome): number {
  if (outcome.correct) {
    if (!state.lastCorrectAt) return S0_DAYS;
    const mult = outcome.withinLimit ? S_PASS_MULT : S_SLOW_PASS_MULT;
    return clamp(state.stabilityS * mult, S_MIN_DAYS, S_MAX_DAYS);
  }
  return clamp(Math.max(S_MIN_DAYS, state.stabilityS * S_FAIL_MULT), S_MIN_DAYS, S_MAX_DAYS);
}

/** §5.1 — whether this outcome counts toward the Level 3 cold streak. */
export function isColdSuccess(outcome: Outcome): boolean {
  return (
    outcome.mode !== "placement" &&
    outcome.correct &&
    !outcome.timedOut &&
    outcome.withinLimit &&
    !outcome.seenBefore &&
    outcome.band >= LEVEL3_MIN_BAND
  );
}

export type LevelContext = {
  /** retention immediately before the outcome being evaluated (§5.1: "at the moment of evaluation") */
  retentionBefore: number | null;
  lessonCompleted?: boolean;
};

/**
 * §5 — the one writer of levels. Pure over the state *after* θ, streak and the
 * recent list have been updated, plus the outcome that produced it.
 */
export function evaluateLevel(
  state: SkillState,
  recent: RecentOutcome[],
  ctx: LevelContext,
  outcome?: Outcome,
): Level {
  let level: Level = state.level;

  if (ctx.lessonCompleted) return level < 1 ? 1 : level;
  if (!outcome || outcome.mode === "placement") return level;

  // Demotion first: a failure is evaluated against the level held going in.
  if (!outcome.correct && outcome.band >= LEVEL3_MIN_BAND) {
    if (level === 3) return 2;
    if (level === 2) {
      const last = recent.slice(0, LEVEL2_DEMOTION_FAILURES);
      if (
        last.length === LEVEL2_DEMOTION_FAILURES &&
        last.every((r) => !r.correct && r.band >= LEVEL3_MIN_BAND)
      ) {
        return 1;
      }
    }
    return level;
  }

  if (outcome.correct && level < 1) level = 1;

  const window = recent.slice(0, LEVEL2_RECENT_WINDOW);
  const rate = window.length ? window.filter((r) => r.correct).length / window.length : 0;
  const workingHolds =
    state.theta >= LEVEL2_MIN_THETA &&
    state.levelAttempts >= LEVEL2_MIN_ATTEMPTS &&
    rate >= LEVEL2_MIN_RECENT_RATE;
  if (level < 2 && workingHolds) level = 2;

  if (
    level === 2 &&
    state.coldStreak >= LEVEL3_STREAK &&
    (ctx.retentionBefore ?? 0) >= LEVEL3_MIN_RETENTION
  ) {
    level = 3;
  }
  return level;
}

/**
 * §3.2–§5 — apply one scored response. Returns the new state and everything the
 * response log needs to record. `b` in the delta is the co-updated item difficulty.
 */
export function applyResponse(
  state: SkillState,
  outcome: Outcome,
  now: Date,
): { state: SkillState; delta: Delta } {
  const y = clamp(finiteOr(outcome.y, 0), 0, 1);
  const p = predictP(state.theta, outcome.b);
  const ku = userRate(state, outcome);
  const c = confidence(outcome);
  const theta = clamp(state.theta + ku * c * (y - p), -THETA_BOUND, THETA_BOUND);
  const b = clamp(outcome.b - itemRate(outcome.itemResponseCount) * (y - p), -THETA_BOUND, THETA_BOUND);

  const attempts = state.attempts + 1;
  const inferred = state.inferred && attempts < INFERRED_FAST_ATTEMPTS;

  if (outcome.mode === "placement") {
    // §7.3, §18.2 — placement sets θ and nothing else.
    const next: SkillState = { ...state, theta, attempts, inferred };
    return {
      state: next,
      delta: makeDelta(state, next, p, ku, c, outcome.b, b),
    };
  }

  const retentionBefore = retention(state, now);
  const cold = isColdSuccess(outcome);
  const entry: RecentOutcome = {
    correct: outcome.correct,
    band: outcome.band,
    cold,
    misconceptionId: outcome.misconceptionId ?? null,
    at: now.getTime(),
  };
  const recent = [entry, ...state.recent].slice(0, RECENT_CAP);

  const stabilityS = nextStability(state, outcome);
  const interim: SkillState = {
    ...state,
    theta,
    attempts,
    levelAttempts: state.levelAttempts + 1,
    inferred,
    coldStreak: cold ? state.coldStreak + 1 : 0,
    stabilityS,
    lastCorrectAt: outcome.correct ? now : state.lastCorrectAt,
    lastPassedBand: outcome.correct ? outcome.band : state.lastPassedBand,
    recent,
  };
  const level = evaluateLevel(interim, recent, { retentionBefore }, outcome);
  const next: SkillState = { ...interim, level };
  return { state: next, delta: makeDelta(state, next, p, ku, c, outcome.b, b) };
}

function makeDelta(
  before: SkillState,
  after: SkillState,
  p: number,
  ku: number,
  c: number,
  bBefore: number,
  bAfter: number,
): Delta {
  return {
    p,
    ku,
    c,
    thetaBefore: before.theta,
    thetaAfter: after.theta,
    bBefore,
    bAfter,
    levelBefore: before.level,
    levelAfter: after.level,
    coldStreakBefore: before.coldStreak,
    coldStreakAfter: after.coldStreak,
    stabilityBefore: before.stabilityS,
    stabilityAfter: after.stabilityS,
  };
}

/**
 * §3.4 — a correct answer is evidence about each direct prerequisite. One hop,
 * upward only, never on failure. Uses the answered skill's Kᵤ and p.
 */
export function propagateToPrereq(
  prereqState: SkillState,
  outcome: Pick<Outcome, "y">,
  delta: Pick<Delta, "ku" | "p">,
): SkillState {
  if (outcome.y !== 1) return prereqState;
  const theta = clamp(
    prereqState.theta + PREREQ_PROPAGATION * delta.ku * (1 - delta.p),
    -THETA_BOUND,
    THETA_BOUND,
  );
  return { ...prereqState, theta };
}

/** §19.4 — completing the learning path earns Familiar and never touches θ. */
export function applyLessonCompletion(state: SkillState): SkillState {
  return { ...state, level: evaluateLevel(state, state.recent, { retentionBefore: null, lessonCompleted: true }) };
}

/**
 * §5.2 route 3 — assessment recalibration. If the assessment implies θ more than
 * RECALIBRATION_GAP below the stored value, shrink toward it and re-check the level.
 */
export function recalibrate(state: SkillState, thetaObserved: number): SkillState {
  if (!(thetaObserved < state.theta - RECALIBRATION_GAP)) return state;
  const theta = RECALIBRATION_SHRINK * state.theta + (1 - RECALIBRATION_SHRINK) * thetaObserved;
  let level: Level = state.level;
  // Interview-ready is a claim about cold performance, which the assessment just contradicted.
  if (level === 3) level = 2;
  if (level === 2 && theta < LEVEL2_MIN_THETA) level = 1;
  return { ...state, theta, level, coldStreak: 0 };
}

/** §10.2 — the band whose predicted p is nearest the target. */
export function bandForTargetP(theta: number, target: number, bands: Band[] = [1, 2, 3, 4, 5]): Band {
  let best: Band = bands[0] ?? 2;
  let bestGap = Infinity;
  for (const band of bands) {
    const gap = Math.abs(predictP(theta, BAND_PRIORS[band]) - target);
    if (gap < bestGap) {
      best = band;
      bestGap = gap;
    }
  }
  return best;
}
