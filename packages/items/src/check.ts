import { parseSubmission } from "./expr";
import type { Instance, NearMissValue, ResolvedTolerance } from "./instance";

export type NumericVerdict =
  | { status: "graded"; correct: boolean; value: number; misconceptionId: string | null }
  | { status: "invalid"; reason: string };

/** §8.4 — |submitted − answer| ≤ max(abs, rel·|answer|), or within a log band for estimates. */
export function withinTolerance(submitted: number, answer: number, tol: ResolvedTolerance): boolean {
  if (tol.log !== undefined) {
    if (submitted <= 0 || answer <= 0) return false;
    return Math.abs(Math.log10(submitted) - Math.log10(answer)) <= tol.log + 1e-12;
  }
  return Math.abs(submitted - answer) <= Math.max(tol.abs, tol.rel * Math.abs(answer));
}

export function matchNearMiss(value: number, list: NearMissValue[], tol: ResolvedTolerance): string | null {
  for (const n of list) if (withinTolerance(value, n.value, { ...tol, log: undefined } as ResolvedTolerance)) return n.misconceptionId;
  return null;
}

/**
 * Grade a typed number. A parse failure is a validation error, not a wrong answer
 * (tech spec §7) — except that an empty submission is a submission and scores
 * incorrect (product spec §8.4), which the caller decides.
 */
export function checkNumeric(
  raw: string,
  answer: number,
  tol: ResolvedTolerance,
  nearMiss: NearMissValue[] = [],
): NumericVerdict {
  const parsed = parseSubmission(raw);
  if (!parsed.ok) return { status: "invalid", reason: parsed.reason };
  const correct = withinTolerance(parsed.value, answer, tol);
  return {
    status: "graded",
    correct,
    value: parsed.value,
    misconceptionId: correct ? null : matchNearMiss(parsed.value, nearMiss, tol),
  };
}

export function checkMcq(instance: Instance, optionId: string): { correct: boolean; misconceptionId: string | null; valid: boolean } {
  const opt = instance.mcq?.options.find((o) => o.id === optionId);
  if (!opt) return { correct: false, misconceptionId: null, valid: false };
  return { correct: opt.correct, misconceptionId: opt.misconceptionId, valid: true };
}
