/**
 * Grading per item type. Numeric and MCQ are graded in-process; symbolic goes to
 * the grader service. Grader failure is never a wrong answer (product spec §8.1.3).
 */
import { checkMcq, checkNumeric, formatNumber, parseSubmission, type CheckpointInstance, type DrillItemInstance, type Instance } from "@qa/items";
import { AppError } from "./errors";
import { getGrader } from "./grader";

export type Graded =
  | { kind: "graded"; correct: boolean; misconceptionId: string | null; display: string }
  | { kind: "void"; reason: string };

/** Throws NOT_A_NUMBER / PARSE_ERROR for a malformed non-empty submission: that is a validation error, not an answer. */
export async function gradeMain(inst: Instance, raw: string): Promise<Graded> {
  const trimmed = raw.trim();
  switch (inst.type) {
    case "numeric": {
      if (!trimmed) return { kind: "graded", correct: false, misconceptionId: null, display: "—" };
      const v = checkNumeric(trimmed, inst.numeric!.answer, inst.numeric!.tolerance, inst.numeric!.nearMiss);
      if (v.status === "invalid") throw new AppError("NOT_A_NUMBER", v.reason, "raw");
      return { kind: "graded", correct: v.correct, misconceptionId: v.misconceptionId, display: trimmed };
    }
    case "mcq": {
      if (!trimmed) return { kind: "graded", correct: false, misconceptionId: null, display: "—" };
      const v = checkMcq(inst, trimmed);
      if (!v.valid) throw new AppError("VALIDATION", "unknown option", "raw");
      const label = inst.mcq!.options.find((o) => o.id === trimmed)!.label;
      return { kind: "graded", correct: v.correct, misconceptionId: v.misconceptionId, display: label };
    }
    case "symbolic":
      return gradeSymbolic(trimmed, inst.symbolic!.answerExpr, inst.symbolic!.variables, inst.symbolic!.assumptions, inst.symbolic!.equivalence);
    default:
      throw new AppError("VALIDATION", `${inst.type} items are answered step by step`);
  }
}

export async function gradeSymbolic(
  raw: string,
  answerExpr: string,
  variables: string[],
  assumptions: Record<string, string>,
  equivalence: "algebraic" | "numeric_probe" = "algebraic",
): Promise<Graded> {
  if (!raw) return { kind: "graded", correct: false, misconceptionId: null, display: "—" };
  const r = await getGrader().grade({ submitted: raw, answer: answerExpr, variables, assumptions, equivalence });
  if (r.status === "parse_error") throw new AppError("PARSE_ERROR", r.message, "raw");
  if (r.status === "unavailable") return { kind: "void", reason: r.reason };
  return { kind: "graded", correct: r.correct, misconceptionId: null, display: raw };
}

export async function gradeCheckpoint(c: CheckpointInstance, raw: string): Promise<Graded> {
  const trimmed = raw.trim();
  if (c.kind === "symbolic") return gradeSymbolic(trimmed, c.answerExpr!, c.variables ?? [], {});
  if (!trimmed) return { kind: "graded", correct: false, misconceptionId: null, display: "—" };
  const v = checkNumeric(trimmed, c.answer!, c.tolerance, c.nearMiss);
  if (v.status === "invalid") throw new AppError("NOT_A_NUMBER", v.reason, "raw");
  return { kind: "graded", correct: v.correct, misconceptionId: v.misconceptionId, display: trimmed };
}

/** Drill sub-items are numeric; an unparseable entry simply counts as not correct (there is no going back). */
export function gradeDrillItem(d: DrillItemInstance, raw: string): { correct: boolean; misconceptionId: string | null } {
  const v = checkNumeric(raw.trim(), d.answer, d.tolerance, d.nearMiss);
  if (v.status === "invalid") return { correct: false, misconceptionId: null };
  return { correct: v.correct, misconceptionId: v.misconceptionId };
}

export function formatAnswer(n: number): string {
  return formatNumber(n);
}

export { parseSubmission };
