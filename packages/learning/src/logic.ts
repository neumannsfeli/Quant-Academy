import {
  LESSON_ENTRY_BAND2_RATE,
  REMEDIATION_SAME_MISCONCEPTION,
  REMEDIATION_WRONG_OF_LAST,
  type RecentOutcome,
} from "@qa/scoring";
import { checkKeys, gradeableKeys, type Lesson, type LessonProgress } from "./lesson";

/** Tech spec §19.2 — the first step not yet viewed, or complete. */
export function nextStep(lesson: Lesson, progress: LessonProgress): string | "complete" {
  for (const s of lesson.steps) {
    if (!progress.viewed.has(s.id)) return s.id;
    if ((s.type === "check" || s.type === "faded") && !stepSolved(lesson, s.id, progress)) return s.id;
  }
  return "complete";
}

export function stepSolved(lesson: Lesson, stepId: string, progress: LessonProgress): boolean {
  const step = lesson.steps.find((s) => s.id === stepId);
  if (!step) return false;
  if (step.type === "check") return progress.solved.has(step.id);
  if (step.type === "faded") {
    return step.steps.every((st, i) => !("blank" in st) || progress.solved.has(`${step.id}#${i}`));
  }
  return true;
}

/** Every step seen, every check (and faded blank) eventually answered correctly. */
export function canComplete(lesson: Lesson, progress: LessonProgress): boolean {
  return (
    lesson.steps.every((s) => progress.viewed.has(s.id)) &&
    gradeableKeys(lesson).every((k) => progress.solved.has(k))
  );
}

export function firstTryRate(lesson: Lesson, progress: LessonProgress): number {
  const keys = checkKeys(lesson);
  if (!keys.length) return 1;
  return keys.filter((k) => progress.firstTry.has(k)).length / keys.length;
}

/** §19.4 — where practice begins after the path. */
export function entryBand(rate: number): 1 | 2 {
  return rate >= LESSON_ENTRY_BAND2_RATE ? 2 : 1;
}

export type RemediationCause = "failure_rate" | "repeat_misconception" | "demotion";

/**
 * §19.6 — 3 wrong of the last 5 scored attempts, the same misconception twice
 * within 10, or any demotion. `recent` is most-recent-first, as SkillState keeps it.
 */
export function shouldRemediate(
  recent: RecentOutcome[],
  demoted: boolean,
): { cause: RemediationCause; misconceptionId: string | null } | null {
  if (demoted) return { cause: "demotion", misconceptionId: recent[0]?.misconceptionId ?? null };
  const window = recent.slice(0, REMEDIATION_WRONG_OF_LAST.of);
  if (
    window.length >= REMEDIATION_WRONG_OF_LAST.of &&
    window.filter((r) => !r.correct).length >= REMEDIATION_WRONG_OF_LAST.wrong
  ) {
    return { cause: "failure_rate", misconceptionId: null };
  }
  const latest = recent[0]?.misconceptionId;
  if (latest) {
    const hits = recent
      .slice(0, REMEDIATION_SAME_MISCONCEPTION.within)
      .filter((r) => r.misconceptionId === latest).length;
    if (hits >= REMEDIATION_SAME_MISCONCEPTION.times) {
      return { cause: "repeat_misconception", misconceptionId: latest };
    }
  }
  return null;
}

/** §19.6 — the tagged concept step, one faded example, two checks. */
export function refresherSteps(lesson: Lesson, misconceptionId: string | null): string[] {
  const tagged = (id: string | null) => (s: Lesson["steps"][number]) =>
    id !== null && (s.addresses ?? []).includes(id);
  const concept =
    lesson.steps.find((s) => s.type === "concept" && tagged(misconceptionId)(s)) ??
    lesson.steps.find((s) => tagged(misconceptionId)(s)) ??
    lesson.steps.find((s) => s.type === "concept");
  const faded = lesson.steps.find((s) => s.type === "faded");
  const checks = lesson.steps.filter((s) => s.type === "check").slice(-2);
  return [concept, faded, ...checks].filter((s): s is NonNullable<typeof s> => !!s).map((s) => s.id);
}

/** §19.10 — actual correctness over predicted, first five practice attempts after the path. */
export function lessonLift(attempts: { p: number; correct: boolean }[]): number | null {
  const first = attempts.slice(0, 5);
  if (!first.length) return null;
  const predicted = first.reduce((s, a) => s + a.p, 0);
  const actual = first.filter((a) => a.correct).length;
  return predicted > 0 ? actual / predicted : null;
}

/** Targeted review: the step that addresses a misconception. */
export function stepForMisconception(lesson: Lesson, misconceptionId: string): string | null {
  return lesson.steps.find((s) => (s.addresses ?? []).includes(misconceptionId))?.id ?? null;
}
