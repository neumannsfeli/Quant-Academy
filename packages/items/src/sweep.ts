import { buildInstance, type Instance } from "./instance";
import type { ItemTemplate } from "./template";

export type SweepIssue = { severity: "fail" | "warn"; code: string; message: string; seed?: number };
export type SweepResult = {
  templateId: string;
  seeds: number;
  distinctAnswers: number;
  distinctInstances: number;
  issues: SweepIssue[];
  passed: boolean;
  previews: Instance[];
};

function answerKey(inst: Instance): string {
  if (inst.numeric) return String(inst.numeric.answer);
  if (inst.mcq) return inst.mcq.options.find((o) => o.correct)!.label;
  if (inst.symbolic) return inst.symbolic.answerExpr;
  if (inst.checkpoints) return inst.checkpoints.map((c) => c.answer ?? c.answerExpr).join("|");
  if (inst.drill) return inst.drill.items.map((i) => i.answer).join("|");
  return "";
}

function numericAnswers(inst: Instance): number[] {
  if (inst.numeric) return [inst.numeric.answer, ...inst.numeric.nearMiss.map((n) => n.value)];
  if (inst.checkpoints) return inst.checkpoints.flatMap((c) => (c.answer !== undefined ? [c.answer] : []));
  if (inst.drill) return inst.drill.items.map((i) => i.answer);
  return [];
}

/**
 * Product spec §12.2 — the seed sweep. Required before promotion to live and run
 * in CI over every live template. Symbolic accept/reject tests need the grader
 * and are checked by the caller.
 */
export function sweepTemplate(template: ItemTemplate, seeds = 200, previewCount = 5): SweepResult {
  const issues: SweepIssue[] = [];
  const answers = new Set<string>();
  const instances = new Set<string>();
  const previews: Instance[] = [];
  const magnitudes: number[] = [];
  let firstFailure = true;

  for (let seed = 1; seed <= seeds; seed++) {
    let inst: Instance;
    try {
      inst = buildInstance(template, seed);
    } catch (e) {
      if (firstFailure) {
        issues.push({ severity: "fail", code: "BUILD", message: (e as Error).message, seed });
        firstFailure = false;
      }
      continue;
    }
    if (previews.length < previewCount) previews.push(inst);
    answers.add(answerKey(inst));
    instances.add(inst.instanceHash);

    for (const v of numericAnswers(inst)) {
      if (!Number.isFinite(v)) {
        issues.push({ severity: "fail", code: "NON_FINITE", message: `answer is ${v}`, seed });
      } else if (v !== 0) magnitudes.push(Math.abs(v));
    }
    if (inst.numeric) {
      for (const n of inst.numeric.nearMiss) {
        if (Math.abs(n.value - inst.numeric.answer) <= Math.max(inst.numeric.tolerance.abs, inst.numeric.tolerance.rel * Math.abs(inst.numeric.answer))) {
          issues.push({ severity: "fail", code: "NEAR_MISS_EQUALS_ANSWER", message: `${n.misconceptionId} coincides with the answer`, seed });
        }
      }
    }
    if (inst.mcq) {
      const labels = inst.mcq.options.map((o) => o.label);
      if (new Set(labels).size !== labels.length) {
        issues.push({ severity: "fail", code: "MCQ_COLLISION", message: `options render identically: ${labels.join(" · ")}`, seed });
      }
    }
    if (/\{\{|\}\}|NaN|undefined|Infinity/.test(inst.stem)) {
      issues.push({ severity: "fail", code: "STEM_RENDER", message: `stem did not render cleanly: ${inst.stem.slice(0, 80)}`, seed });
    }
  }

  const needsSpread = template.type !== "symbolic";
  const zeroParams = !template.params || template.params.length === 0;
  if (needsSpread && !zeroParams && answers.size < 20) {
    issues.push({ severity: "fail", code: "FEW_DISTINCT", message: `only ${answers.size} distinct answers across ${seeds} seeds (need 20)` });
  }
  if (zeroParams && template.type !== "drill") {
    issues.push({ severity: "warn", code: "FIXED_INSTANCE", message: "template has no parameters: every seed is the same question" });
  }
  if (magnitudes.length) {
    const span = Math.log10(Math.max(...magnitudes) / Math.min(...magnitudes));
    if (span > 6) issues.push({ severity: "fail", code: "MAGNITUDE_SPAN", message: `answers span ${span.toFixed(1)} orders of magnitude` });
  }

  // Collapse repeated per-seed issues to the first occurrence of each code.
  const seen = new Set<string>();
  const deduped = issues.filter((i) => (seen.has(i.code) ? false : (seen.add(i.code), true)));
  return {
    templateId: template.id,
    seeds,
    distinctAnswers: answers.size,
    distinctInstances: instances.size,
    issues: deduped,
    passed: !deduped.some((i) => i.severity === "fail"),
    previews,
  };
}
