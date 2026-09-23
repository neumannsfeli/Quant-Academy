/**
 * Every tunable in product spec §20, and nothing else.
 *
 * Changing a value here is a one-line diff; `test/constants.test.ts` asserts the
 * published values so that a change is always deliberate.
 */

export type Band = 1 | 2 | 3 | 4 | 5;
export type Level = 0 | 1 | 2 | 3;

/** §3.1 — difficulty prior for each band, on the logistic scale. */
export const BAND_PRIORS: Readonly<Record<Band, number>> = {
  1: -1.2,
  2: -0.4,
  3: 0.4,
  4: 1.2,
  5: 2.0,
};

/** §3.2 — user learning rate Kᵤ, by scored attempts n on the skill. */
export const KU_SCHEDULE = [
  { below: 10, k: 0.6 },
  { below: 30, k: 0.35 },
  { below: Infinity, k: 0.2 },
] as const;

/** §7.1 — placement and uninformed (inferred) estimates use the highest rate. */
export const KU_PLACEMENT = 0.6;
/** §7.2 — inferred skills keep KU_PLACEMENT until this many real attempts. */
export const INFERRED_FAST_ATTEMPTS = 3;

/** §3.2 — item calibration rate Kᵢ, by responses m to the template. */
export const KI_SCHEDULE = [
  { below: 50, k: 0.08 },
  { below: Infinity, k: 0.02 },
] as const;

/** §3.2 — confidence multiplier c on the user update. */
export const CONFIDENCE_UNCALIBRATED = 0.6;
export const UNCALIBRATED_BELOW_RESPONSES = 20;
export const CONFIDENCE_SEEN = 0.25;
export const CONFIDENCE_FULL = 1.0;

/** §3.4 — prerequisite propagation: share of the update, one hop, correct only. */
export const PREREQ_PROPAGATION = 0.15;

/** §4.2 — stability S, in days. */
export const S0_DAYS = 6;
export const S_PASS_MULT = 2.3;
export const S_SLOW_PASS_MULT = 1.6;
export const S_FAIL_MULT = 0.35;
export const S_MIN_DAYS = 2;
export const S_MAX_DAYS = 180;

/** §4.3 — a review is due when predicted retention falls below this. */
export const REVIEW_THRESHOLD = 0.85;

/** §5.1 — level criteria. */
export const LEVEL2_MIN_THETA = 0.1;
export const LEVEL2_MIN_ATTEMPTS = 3;
export const LEVEL2_RECENT_WINDOW = 5;
export const LEVEL2_MIN_RECENT_RATE = 0.6;
export const LEVEL3_STREAK = 3;
export const LEVEL3_MIN_BAND: Band = 3;
export const LEVEL3_MIN_RETENTION = 0.8;
/** §5.2 route 2 — consecutive failures at band ≥ 3 that demote Working → Familiar. */
export const LEVEL2_DEMOTION_FAILURES = 2;

/** §5.2 route 3 — assessment recalibration. */
export const RECALIBRATION_GAP = 0.6;
export const RECALIBRATION_SHRINK = 0.5;

/** §6.1 — readiness skill score. */
export const SKILL_SCORE_SLOPE = 1.1;
export const FRESHNESS_FLOOR = 0.6;
export const LEVEL_CAPS: Readonly<Record<Level, number>> = { 0: 55, 1: 55, 2: 80, 3: 100 };

/** §6.3 — readiness blend. */
export const READINESS_MEAN_WEIGHT = 0.25;
export const READINESS_POWER_WEIGHT = 0.75;
export const READINESS_POWER_P = -4;

/**
 * Domain score shown as the "target" on Home. 75 is the skill score of a user one
 * logit above the band prior the profile requires: 100·σ(1.1·1) ≈ 75.
 */
export const DOMAIN_TARGET = 75;

/** §6.5 — provisional thresholds. */
export const PROVISIONAL_MIN_ATTEMPTS = 20;
export const PROVISIONAL_MIN_PER_DOMAIN = 5;

/** §6.7 / §10.4 — assessment. */
export const VALIDATION_WINDOW_DAYS = 21;
export const ASSESSMENT_UNLOCK_WORKING_SKILLS = 8;
export const ASSESSMENT_UNLOCK_DAYS = 14;
export const ASSESSMENT_UNLOCK_ATTEMPTS = 100;
export const ASSESSMENT_PASS_COMPOSITE = 65;
export const ASSESSMENT_PASS_DOMAIN_FLOOR = 40;
export const ASSESSMENT_CADENCE_DAYS = 14;

/** §7 — placement. */
export const PLACEMENT_ITEMS = 24;
export const PLACEMENT_MIN_PER_DOMAIN = 5;
export const INFERRED_PENALTY = 0.3;
export const SKIP_PRIOR_THETA = -0.5;

/** §8 — item types. */
export const DRILL_KU_SET_SIZE = 10;
export const DRILL_PASS_FRACTION = 0.8;
export const GRADER_TIMEOUT_MS = 2000;
export const NUMERIC_PROBE_POINTS = 20;
export const SEEN_WINDOW_DAYS = 90;

/** §9 — timing. */
export const TIMEOUT_GRACE_MS = 2000;
export const ABANDON_AFTER_LIMIT_MS = 5 * 60 * 1000;

/** §10 — session composition. */
export const TARGET_P = 0.75;
export const SESSION_REVIEW_SHARE = 0.4;
export const SESSION_REVIEW_SHARE_BACKLOG = 0.6;
export const SESSION_WEAKEST_SHARE = 0.3;
export const SESSION_DEFAULT_MINUTES = 30;
export const MEDIAN_FALLBACK_SHARE_OF_LIMIT = 0.5;
export const MEDIAN_MIN_RESPONSES = 30;
export const MAX_CONSECUTIVE_SAME_DOMAIN = 3;

/** §19 — learning. */
export const LESSON_LED_UNTIL_FAMILIAR_SHARE = 0.6;
export const LESSON_ENTRY_BAND2_RATE = 0.7;
export const REMEDIATION_WRONG_OF_LAST = { wrong: 3, of: 5 } as const;
export const REMEDIATION_SAME_MISCONCEPTION = { times: 2, within: 10 } as const;

/** Numerical guard: θ and b live on a bounded logistic scale. */
export const THETA_BOUND = 6;

export const DAY_MS = 86_400_000;
