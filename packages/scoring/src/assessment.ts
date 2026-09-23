import {
  ASSESSMENT_CADENCE_DAYS,
  ASSESSMENT_PASS_COMPOSITE,
  ASSESSMENT_PASS_DOMAIN_FLOOR,
  ASSESSMENT_UNLOCK_ATTEMPTS,
  ASSESSMENT_UNLOCK_DAYS,
  ASSESSMENT_UNLOCK_WORKING_SKILLS,
  DAY_MS,
  VALIDATION_WINDOW_DAYS,
} from "./constants";
import type { SkillState } from "./types";

export type UnlockStatus = {
  unlocked: boolean;
  workingSkills: number;
  daysSinceSignup: number;
  attempts: number;
  /** earliest date the cadence rule allows another attempt, if one was taken */
  nextAllowedAt: Date | null;
};

/** §10.4 — 8 skills at Working, or 14 days plus 100 scored attempts; at most once per 14 days. */
export function assessmentUnlock(
  states: Iterable<SkillState>,
  signupAt: Date,
  lastAssessmentAt: Date | null,
  now: Date,
): UnlockStatus {
  let workingSkills = 0;
  let attempts = 0;
  for (const s of states) {
    if (s.level >= 2) workingSkills++;
    attempts += s.attempts;
  }
  const daysSinceSignup = (now.getTime() - signupAt.getTime()) / DAY_MS;
  const eligible =
    workingSkills >= ASSESSMENT_UNLOCK_WORKING_SKILLS ||
    (daysSinceSignup >= ASSESSMENT_UNLOCK_DAYS && attempts >= ASSESSMENT_UNLOCK_ATTEMPTS);
  const nextAllowedAt = lastAssessmentAt
    ? new Date(lastAssessmentAt.getTime() + ASSESSMENT_CADENCE_DAYS * DAY_MS)
    : null;
  const cadenceOk = !nextAllowedAt || nextAllowedAt.getTime() <= now.getTime();
  return { unlocked: eligible && cadenceOk, workingSkills, daysSinceSignup, attempts, nextAllowedAt };
}

/** §10.4 — composite ≥ 65% and no required domain below 40%. */
export function assessmentPassed(composite: number, domainPercents: number[]): boolean {
  return (
    composite >= ASSESSMENT_PASS_COMPOSITE &&
    domainPercents.every((d) => d >= ASSESSMENT_PASS_DOMAIN_FLOOR)
  );
}

/** §6.7 — validated for 21 days after a passed assessment. */
export function isValidated(lastPassedAt: Date | null, now: Date): boolean {
  if (!lastPassedAt) return false;
  return now.getTime() - lastPassedAt.getTime() <= VALIDATION_WINDOW_DAYS * DAY_MS;
}

/**
 * θ implied by assessment performance on one skill: the θ at which the observed
 * proportion correct is the expected one, given the items' difficulties.
 * Solved by bisection; bounded so that all-correct or all-wrong stay finite.
 */
export function observedTheta(results: { correct: number; b: number }[]): number | null {
  if (!results.length) return null;
  const f = (t: number) =>
    results.reduce((s, r) => s + (r.correct - 1 / (1 + Math.exp(-(t - r.b)))), 0);
  let lo = -4;
  let hi = 4;
  if (f(lo) <= 0) return lo;
  if (f(hi) >= 0) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
