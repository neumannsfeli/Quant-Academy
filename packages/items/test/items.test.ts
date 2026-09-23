import { describe, expect, it } from "vitest";
import {
  Prng,
  buildInstance,
  checkNumeric,
  evaluate,
  fnv1a32,
  parseSubmission,
  renderText,
  resolveTolerance,
  sweepTemplate,
  toClientItem,
  type ItemTemplate,
} from "../src";
import golden from "./fixtures/prng-golden.json";

describe("PRNG golden fixture (tech spec §7)", () => {
  it("fnv1a32 matches the reference", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });
  it("a fixed seed produces a fixed sequence", () => {
    const rng = Prng.forInstance("prob.linearity.b2.dice-sum", 1, 42);
    const seq = Array.from({ length: 16 }, () => rng.nextU32());
    expect(seq).toEqual(golden.sequence);
  });
});

describe("expression parser", () => {
  const cases: [string, number][] = [
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["2 ^ 3 ^ 2", 512],
    ["-2 ^ 2", -4],
    ["2 ^ -1", 0.5],
    ["choose(10, 3)", 120],
    ["factorial(5) / 2", 60],
    ["mod(-7, 3)", 2],
    ["max(1, 5, 3) - min(4, 2)", 3],
    ["floor(7/2) + ceil(7/2)", 7],
    ["3 > 2 && !(1 == 2)", 1],
    ["1e3 + .5", 1000.5],
    ["log(e)", 1],
  ];
  for (const [src, v] of cases) it(src, () => expect(evaluate(src)).toBeCloseTo(v, 12));

  it("rejects anything outside the grammar", () => {
    for (const bad of ["sum(1,2)", "a.b", "x[0]", "__proto__", "1 +", "max()", "(1", "choose(1)", "alert`1`"]) {
      expect(() => evaluate(bad, { a: 1, x: 1 })).toThrow();
    }
  });

  it("numeric submissions use the reduced grammar", () => {
    expect(parseSubmission("27/4")).toEqual({ ok: true, value: 6.75 });
    expect(parseSubmission("$1,250.50")).toEqual({ ok: true, value: 1250.5 });
    expect(parseSubmission("2 3/4")).toEqual({ ok: true, value: 2.75 });
    expect(parseSubmission("12%")).toEqual({ ok: true, value: 12 });
    expect(parseSubmission("pi/2").ok).toBe(true);
    expect(parseSubmission("n+1").ok).toBe(false);
    expect(parseSubmission("1 < 2").ok).toBe(false);
    expect(parseSubmission("(".repeat(40) + "1" + ")".repeat(40)).ok).toBe(false);
    expect(parseSubmission("").ok).toBe(false);
  });
});

describe("answer checking (product spec §8.4)", () => {
  const tol = resolveTolerance();
  it("27/4, 6.75, 6.750 and 6.75000001 all match; 6.7 does not", () => {
    for (const s of ["27/4", "6.75", "6.750", "6.75000001"]) {
      expect(checkNumeric(s, 6.75, tol)).toMatchObject({ status: "graded", correct: true });
    }
    expect(checkNumeric("6.7", 6.75, tol)).toMatchObject({ status: "graded", correct: false });
  });
  it("a typo is a validation error, not a wrong answer", () => {
    expect(checkNumeric("6..75", 6.75, tol).status).toBe("invalid");
  });
  it("diagnoses a near miss", () => {
    const v = checkNumeric("13.5", 17.5, tol, [{ value: 13.5, misconceptionId: "mc.prob.max-of-expectation" }]);
    expect(v).toMatchObject({ correct: false, misconceptionId: "mc.prob.max-of-expectation" });
  });
  it("log tolerance for estimates", () => {
    const t = resolveTolerance({ log: 0.3 });
    expect(checkNumeric("150", 100, t)).toMatchObject({ correct: true });
    expect(checkNumeric("250", 100, t)).toMatchObject({ correct: false });
  });
});

const dice: ItemTemplate = {
  id: "prob.linearity.b2.dice-sum",
  version: 1,
  skill_id: "prob.linearity",
  band: 2,
  type: "numeric",
  params: [
    { name: "n", type: "int", min: 2, max: 12 },
    { name: "k", type: "choice", values: [4, 6, 8, 10, 12, 20] },
  ],
  stem: "You roll {{n}} fair {{k}}-sided dice. What is $E[\\text{sum}]$?",
  answer: "n*(k+1)/2",
  near_miss: [{ expr: "n*k/2", misconception_id: "mc.prob.off-by-one-mean" }],
  time_limit_sec: 180,
  solution_steps: ["Each die has mean $({{k}}+1)/2 = {{(k+1)/2}}$.", "By linearity, the sum has mean {{n*(k+1)/2}}."],
};

const mcq: ItemTemplate = {
  id: "prob.bayes.b3.test",
  version: 1,
  skill_id: "prob.bayes",
  band: 3,
  type: "mcq",
  params: [
    { name: "prior", type: "choice", values: [0.01, 0.02, 0.05] },
    { name: "sens", type: "choice", values: [0.9, 0.95, 0.99] },
    { name: "fpr", type: "choice", values: [0.05, 0.1] },
  ],
  stem: "Prior {{prior|percent}}, sensitivity {{sens|percent}}, false positive rate {{fpr|percent}}. P(disease | +)?",
  answer: "prior*sens/(prior*sens + (1-prior)*fpr)",
  distractors: [
    { expr: "sens", misconception_id: "mc.prob.base-rate-neglect" },
    { expr: "prior", misconception_id: "mc.prob.ignores-evidence" },
    { expr: "1-fpr", misconception_id: "mc.prob.inverted-conditional" },
  ],
  display: { format: "percent", decimals: 1 },
  time_limit_sec: 360,
};

describe("instances", () => {
  it("are deterministic in (template, version, seed)", () => {
    expect(buildInstance(dice, 7)).toEqual(buildInstance(dice, 7));
    expect(buildInstance(dice, 7).instanceHash).not.toEqual(buildInstance({ ...dice, version: 2 }, 7).instanceHash);
  });

  it("render values into stems and solutions", () => {
    const inst = buildInstance(dice, 3);
    const { n, k } = inst.params as { n: number; k: number };
    expect(inst.stem).toContain(`${n} fair ${k}-sided`);
    expect(inst.numeric!.answer).toBe((n * (k + 1)) / 2);
  });

  it("escape separators inside maths", () => {
    expect(renderText("$x = {{a}}$ and {{a}}", { a: 12345 })).toBe("$x = 12{,}345$ and 12,345");
  });

  it("MCQ options are shuffled per seed and exactly one is correct", () => {
    const positions = new Set<number>();
    for (let s = 1; s <= 40; s++) {
      const inst = buildInstance(mcq, s);
      expect(inst.mcq!.options.filter((o) => o.correct)).toHaveLength(1);
      positions.add(inst.mcq!.options.findIndex((o) => o.correct));
    }
    expect(positions.size).toBeGreaterThan(2);
  });

  it("the client payload never contains the answer (hostile-client check)", () => {
    for (let s = 1; s <= 50; s++) {
      for (const t of [dice, mcq]) {
        const inst = buildInstance(t, s);
        const payload = JSON.stringify(toClientItem(inst));
        expect(payload).not.toMatch(/correct|misconception|answer|solution|params/i);
        if (inst.numeric) expect(payload).not.toContain(`"${inst.numeric.answer}"`);
      }
    }
  });
});

describe("seed sweep (product spec §12.2)", () => {
  it("passes a healthy template", () => {
    const r = sweepTemplate(dice);
    expect(r.issues).toEqual([]);
    expect(r.passed).toBe(true);
  });
  it("fails an over-constrained template", () => {
    const r = sweepTemplate({ ...dice, constraints: ["n > 100"] });
    expect(r.passed).toBe(false);
    expect(r.issues[0]!.code).toBe("BUILD");
  });
  it("fails MCQ options that collide at display precision", () => {
    const r = sweepTemplate({ ...mcq, display: { format: "percent", decimals: 0 }, distractors: [
      { expr: "prior*sens/(prior*sens + (1-prior)*fpr) + 0.001", misconception_id: "x" },
      { expr: "prior", misconception_id: "y" },
      { expr: "1-fpr", misconception_id: "z" },
    ] } as ItemTemplate);
    expect(r.issues.map((i) => i.code)).toContain("MCQ_COLLISION");
  });
  it("fails too few distinct answers", () => {
    const r = sweepTemplate({ ...dice, params: [{ name: "n", type: "int", min: 2, max: 3 }, { name: "k", type: "choice", values: [6] }] } as ItemTemplate);
    expect(r.issues.map((i) => i.code)).toContain("FEW_DISTINCT");
  });
});
