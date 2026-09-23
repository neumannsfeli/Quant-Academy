import { evaluate } from "@qa/items";
import type { Lesson } from "./lesson";

export type LessonIssue = { severity: "fail" | "warn"; message: string };

/** §19.2 hard rules — enforced by validate.py and again before promotion. */
export function validateLesson(lesson: Lesson, misconceptionIds?: Set<string>): LessonIssue[] {
  const issues: LessonIssue[] = [];
  const fail = (message: string) => issues.push({ severity: "fail", message });
  const steps = lesson.steps;
  if (steps.length < 6 || steps.length > 12) fail(`${steps.length} steps; a path has 6–12`);
  const ids = steps.map((s) => s.id);
  if (new Set(ids).size !== ids.length) fail("step ids must be unique");
  const count = (t: string) => steps.filter((s) => s.type === t).length;
  if (count("worked") < 1) fail("needs at least one worked example");
  if (count("faded") < 1) fail("needs at least one faded example");
  if (count("trap") !== 1) fail("needs exactly one trap");
  const checks = steps.filter((s) => s.type === "check");
  if (checks.length < 3) fail(`${checks.length} checks; at least three`);
  const last = checks[checks.length - 1];
  if (last && !(last.type === "check" && last.transfer)) fail("the last check must be marked transfer: true");
  if (steps[steps.length - 1]?.type !== "summary") fail("the final step must be the summary");
  let run = 0;
  for (const s of steps) {
    run = s.type === "check" ? 0 : run + 1;
    if (run > 3 && s.type !== "summary") {
      fail(`more than three steps in a row without a check (at "${s.id}")`);
      break;
    }
  }
  for (const s of steps) {
    if (s.type === "concept") {
      const words = s.body.split(/\s+/).filter(Boolean).length;
      if (words > 150) issues.push({ severity: "warn", message: `concept "${s.id}" is ${words} words (≤ 150)` });
    }
    if (s.type === "check") {
      if ((s.check.hints ?? []).length > 2) fail(`check "${s.id}" has more than two hints`);
      if (s.check.type === "numeric") {
        try {
          if (!Number.isFinite(evaluate(s.check.answer))) fail(`check "${s.id}" answer is not finite`);
        } catch (e) {
          fail(`check "${s.id}" answer does not evaluate: ${(e as Error).message}`);
        }
      }
    }
    if (s.type === "faded") {
      s.steps.forEach((st, i) => {
        if ("blank" in st) {
          try {
            evaluate(st.blank.answer);
          } catch (e) {
            fail(`faded "${s.id}" blank ${i} does not evaluate: ${(e as Error).message}`);
          }
        }
      });
    }
    if (s.type === "trap" && (s.error_step < 0 || s.error_step >= s.flawed_solution.length)) {
      fail(`trap error_step ${s.error_step} is out of range`);
    }
    if (misconceptionIds) {
      for (const m of s.addresses ?? []) if (!misconceptionIds.has(m)) fail(`unknown misconception "${m}" on "${s.id}"`);
    }
  }
  return issues;
}
