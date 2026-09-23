import { createHash } from "node:crypto";
import { evaluate, type Scope } from "./expr";
import { formatNumber, parseFormat } from "./format";
import { Prng } from "./prng";
import {
  DEFAULT_TOLERANCE,
  type Derived,
  type ItemTemplate,
  type NearMiss,
  type Param,
  type Tolerance,
} from "./template";

export const MAX_RESAMPLES = 50;

export class OverConstrainedTemplate extends Error {
  constructor(readonly templateId: string, readonly seed: number) {
    super(`template ${templateId} is over-constrained: no valid parameters within ${MAX_RESAMPLES} attempts (seed ${seed})`);
    this.name = "OverConstrainedTemplate";
  }
}

export type Sampled = {
  params: Record<string, number>;
  /** params plus derived values — the scope every expression sees */
  scope: Record<string, number>;
  /** text substitutions: `{name}_label` for labelled choices */
  text: Record<string, string>;
};

function sampleParam(p: Param, rng: Prng): number {
  switch (p.type) {
    case "int": {
      const step = p.step ?? 1;
      const n = Math.floor((p.max - p.min) / step);
      return p.min + step * rng.int(0, n);
    }
    case "float": {
      const n = Math.round((p.max - p.min) / p.step);
      const v = p.min + p.step * rng.int(0, n);
      const decimals = Math.max(0, -Math.floor(Math.log10(p.step)) + 1);
      return Number(v.toFixed(decimals));
    }
    case "choice":
      return rng.pick(p.values);
  }
}

/** §8.3 — sample in declared order, resample on constraint failure, up to 50 attempts. */
export function sampleParams(
  params: Param[] | undefined,
  constraints: string[] | undefined,
  derived: Derived[] | undefined,
  rng: Prng,
  onFail: () => never,
): Sampled {
  for (let attempt = 0; attempt < MAX_RESAMPLES; attempt++) {
    const values: Record<string, number> = {};
    const text: Record<string, string> = {};
    for (const p of params ?? []) {
      const v = sampleParam(p, rng);
      values[p.name] = v;
      if (p.type === "choice" && p.labels) {
        text[`${p.name}_label`] = p.labels[p.values.indexOf(v)] ?? String(v);
      }
    }
    const scope: Record<string, number> = { ...values };
    let ok = true;
    try {
      for (const d of derived ?? []) scope[d.name] = evaluate(d.expr, scope);
      for (const c of constraints ?? []) {
        if (!evaluate(c, scope)) {
          ok = false;
          break;
        }
      }
    } catch {
      ok = false;
    }
    if (ok) return { params: values, scope, text };
  }
  return onFail();
}

/**
 * Render `{{expr}}` and `{{expr|format}}` against the scope. Inside `$…$` maths,
 * separators and symbols are escaped for KaTeX.
 */
export function renderText(tpl: string, scope: Scope, text: Record<string, string> = {}): string {
  let inMath = false;
  let out = "";
  let i = 0;
  while (i < tpl.length) {
    if (tpl.startsWith("{{", i)) {
      const end = tpl.indexOf("}}", i + 2);
      if (end < 0) throw new Error(`unterminated placeholder in "${tpl.slice(i, i + 30)}"`);
      const body = tpl.slice(i + 2, end).trim();
      const bar = body.lastIndexOf("|");
      const expr = (bar >= 0 ? body.slice(0, bar) : body).trim();
      const fmt = bar >= 0 ? body.slice(bar + 1).trim() : undefined;
      let rendered: string;
      if (expr in text) rendered = text[expr]!;
      else rendered = formatNumber(evaluate(expr, scope), parseFormat(fmt));
      if (inMath) rendered = rendered.replace(/,/g, "{,}").replace(/%/g, "\\%").replace(/\$/g, "\\$");
      out += rendered;
      i = end + 2;
      continue;
    }
    const ch = tpl[i]!;
    if (ch === "\\" && tpl[i + 1] === "$") {
      out += "\\$";
      i += 2;
      continue;
    }
    if (ch === "$") inMath = !inMath;
    out += ch;
    i++;
  }
  return out;
}

/** Substitute parameter values into an expression, leaving the free variables. */
export function substitute(expr: string, scope: Scope): string {
  return expr.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (id) => {
    const v = scope[id];
    if (v === undefined) return id;
    return v < 0 ? `(${v})` : String(v);
  });
}

export function instanceHash(templateId: string, version: number, params: Record<string, number>): string {
  const entries = Object.keys(params)
    .sort()
    .map((k) => [k, params[k]]);
  return createHash("sha256").update(JSON.stringify([templateId, version, entries])).digest("hex");
}

export type ResolvedTolerance = { abs: number; rel: number; log?: number };

export function resolveTolerance(t?: Tolerance): ResolvedTolerance {
  return {
    abs: t?.abs ?? DEFAULT_TOLERANCE.abs,
    rel: t?.rel ?? DEFAULT_TOLERANCE.rel,
    ...(t?.log !== undefined ? { log: t.log } : {}),
  };
}

export type NearMissValue = { value: number; misconceptionId: string };

export type McqOption = {
  id: string;
  label: string;
  correct: boolean;
  misconceptionId: string | null;
};

export type CheckpointInstance = {
  prompt: string;
  kind: "numeric" | "symbolic";
  answer?: number;
  answerExpr?: string;
  variables?: string[];
  tolerance: ResolvedTolerance;
  nearMiss: NearMissValue[];
  display: string;
};

export type DrillItemInstance = {
  stem: string;
  answer: number;
  tolerance: ResolvedTolerance;
  nearMiss: NearMissValue[];
};

/** The full, server-only instance. Never sent to a client — see project.ts. */
export type Instance = {
  templateId: string;
  version: number;
  seed: number;
  skillId: string;
  band: 1 | 2 | 3 | 4 | 5;
  type: ItemTemplate["type"];
  timeLimitSec: number;
  params: Record<string, number>;
  instanceHash: string;
  stem: string;
  solutionSteps: string[];
  /** LaTeX-ready rendering of the correct answer for the answer screen */
  answerDisplay: string;
  numeric?: { answer: number; tolerance: ResolvedTolerance; unit: string; nearMiss: NearMissValue[] };
  mcq?: { options: McqOption[] };
  symbolic?: {
    answerExpr: string;
    variables: string[];
    assumptions: Record<string, string>;
    equivalence: "algebraic" | "numeric_probe";
  };
  checkpoints?: CheckpointInstance[];
  drill?: { items: DrillItemInstance[]; totalSec: number; passFraction: number };
};

function nearMisses(list: NearMiss[] | undefined, scope: Scope): NearMissValue[] {
  return (list ?? []).map((n) => ({ value: evaluate(n.expr, scope), misconceptionId: n.misconception_id }));
}

/** Tech spec §7 — (template, seed) → instance, deterministically. */
export function buildInstance(template: ItemTemplate, seed: number): Instance {
  const rng = Prng.forInstance(template.id, template.version, seed);
  const fail = (): never => {
    throw new OverConstrainedTemplate(template.id, seed);
  };
  const { params, scope, text } = sampleParams(template.params, template.constraints, template.derived, rng, fail);
  const render = (s: string) => renderText(s, scope, text);

  const base = {
    templateId: template.id,
    version: template.version,
    seed,
    skillId: template.skill_id,
    band: template.band,
    type: template.type,
    timeLimitSec: template.time_limit_sec,
    params,
    instanceHash: instanceHash(template.id, template.version, params),
    stem: render(template.stem),
    solutionSteps: (template.solution_steps ?? []).map(render),
  };

  switch (template.type) {
    case "numeric": {
      const answer = evaluate(template.answer, scope);
      const unit = template.unit ?? "none";
      return {
        ...base,
        answerDisplay: template.answer_display ? render(template.answer_display) : formatNumber(answer, unit === "percent" ? { kind: "fixed", decimals: 2 } : { kind: "auto" }) + (unit === "percent" ? "\\%" : ""),
        numeric: { answer, tolerance: resolveTolerance(template.tolerance), unit, nearMiss: nearMisses(template.near_miss, scope) },
      };
    }
    case "mcq": {
      const fmt = template.display
        ? template.display.format === "percent"
          ? { kind: "percent" as const, decimals: template.display.decimals ?? 0 }
          : template.display.format === "fraction"
            ? { kind: "fraction" as const }
            : template.display.decimals !== undefined
              ? { kind: "fixed" as const, decimals: template.display.decimals }
              : { kind: "auto" as const }
        : { kind: "auto" as const };
      const labelOf = (o: { expr?: string; label?: string }) =>
        o.label !== undefined ? render(o.label) : formatNumber(evaluate(o.expr!, scope), fmt);
      const correctLabel =
        template.answer_label !== undefined ? render(template.answer_label) : labelOf({ expr: template.answer! });
      const raw: Omit<McqOption, "id">[] = [
        { label: correctLabel, correct: true, misconceptionId: null },
        ...template.distractors.map((d) => ({ label: labelOf(d), correct: false, misconceptionId: d.misconception_id })),
      ];
      const shuffled = rng.shuffle(raw).map((o, i) => ({ ...o, id: "ABCDEFGH"[i]! }));
      return { ...base, answerDisplay: correctLabel, mcq: { options: shuffled } };
    }
    case "symbolic": {
      const answerExpr = substitute(template.answer_expr, scope);
      return {
        ...base,
        answerDisplay: template.answer_display ? render(template.answer_display) : answerExpr,
        symbolic: {
          answerExpr,
          variables: template.variables,
          assumptions: Object.fromEntries((template.domain_hints ?? []).map((h) => [h.var, h.assume])),
          equivalence: template.equivalence ?? "algebraic",
        },
      };
    }
    case "multistep": {
      const checkpoints: CheckpointInstance[] = template.checkpoints.map((c) => {
        if (c.kind === "numeric") {
          const answer = evaluate(c.answer!, scope);
          return {
            prompt: render(c.prompt),
            kind: "numeric",
            answer,
            tolerance: resolveTolerance(c.tolerance),
            nearMiss: nearMisses(c.near_miss, scope),
            display: formatNumber(answer),
          };
        }
        const answerExpr = substitute(c.answer_expr!, scope);
        return {
          prompt: render(c.prompt),
          kind: "symbolic",
          answerExpr,
          variables: c.variables ?? [],
          tolerance: resolveTolerance(c.tolerance),
          nearMiss: [],
          display: answerExpr,
        };
      });
      return {
        ...base,
        answerDisplay: template.answer_display ? render(template.answer_display) : checkpoints[checkpoints.length - 1]!.display,
        checkpoints,
      };
    }
    case "drill": {
      const spec = template.drill;
      const items: DrillItemInstance[] = [];
      for (let k = 0; k < spec.count; k++) {
        const sub = Prng.forInstance(template.id, template.version, seed, `drill:${k}`);
        const s = sampleParams(spec.item.params, spec.item.constraints, spec.item.derived, sub, fail);
        items.push({
          stem: renderText(spec.item.stem, s.scope, s.text),
          answer: evaluate(spec.item.answer, s.scope),
          tolerance: resolveTolerance(spec.item.tolerance),
          nearMiss: nearMisses(spec.item.near_miss, s.scope),
        });
      }
      // The instance fingerprint for a drill is the whole set of rendered sub-items.
      return {
        ...base,
        instanceHash: instanceHash(template.id, template.version, { ...params, ...Object.fromEntries(items.map((it, k) => [`q${k}`, hashNum(it.stem)])) }),
        answerDisplay: `${spec.count} items`,
        drill: { items, totalSec: spec.total_sec, passFraction: spec.pass_fraction ?? 0.8 },
      };
    }
  }
}

function hashNum(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
