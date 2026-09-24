import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyLessonCompletion, initialSkillState, type RecentOutcome, type SkillState } from "@qa/scoring";
import { canComplete, emptyProgress, entryBand, lessonLift, nextStep, shouldRemediate, validateLesson, type Lesson } from "../src";

const lesson: Lesson = {
  skill_id: "x", version: 1, title: "T", est_minutes: 15, key_results: ["k"],
  steps: [
    { id: "hook", type: "concept", body: "b" },
    { id: "w", type: "worked", problem: "p", steps: [{ text: "s" }] },
    { id: "c1", type: "check", check: { type: "numeric", stem: "?", answer: "1/2", solution: "s" } },
    { id: "f", type: "faded", problem: "p", steps: [{ text: "a" }, { blank: { prompt: "?", answer: "2" } }] },
    { id: "c2", type: "check", check: { type: "numeric", stem: "?", answer: "3", solution: "s" } },
    { id: "t", type: "trap", prompt: "p", flawed_solution: ["a", "b"], error_step: 1, explanation: "e" },
    { id: "c3", type: "check", transfer: true, check: { type: "numeric", stem: "?", answer: "4", solution: "s" } },
    { id: "sum", type: "summary", body: "s" },
  ],
};

describe("learning path", () => {
  it("validates against the hard rules", () => {
    expect(validateLesson(lesson)).toEqual([]);
    const bad = { ...lesson, steps: lesson.steps.filter((s) => s.type !== "trap") };
    expect(validateLesson(bad).map((i) => i.message)).toContain("needs exactly one trap");
  });

  it("completes only when every step is seen and every check solved", () => {
    const p = emptyProgress();
    for (const s of lesson.steps) p.viewed.add(s.id);
    expect(canComplete(lesson, p)).toBe(false);
    expect(nextStep(lesson, p)).toBe("c1");
    for (const k of ["c1", "f#1", "c2", "c3"]) p.solved.add(k);
    expect(canComplete(lesson, p)).toBe(true);
    expect(nextStep(lesson, p)).toBe("complete");
  });

  it("entry band from first-try rate", () => {
    expect(entryBand(0.7)).toBe(2);
    expect(entryBand(0.69)).toBe(1);
  });

  it("lesson completion never changes θ and never grants more than Familiar", () => {
    fc.assert(
      fc.property(fc.double({ min: -3, max: 3, noNaN: true }), fc.constantFrom(0, 1, 2, 3), (theta, level) => {
        const s: SkillState = { ...initialSkillState(theta), level: level as 0 | 1 | 2 | 3 };
        const after = applyLessonCompletion(s);
        expect(after.theta).toBe(theta);
        expect(after.level).toBe(Math.max(1, level));
        expect({ ...after, level: s.level }).toEqual(s);
      }),
    );
  });
});

const r = (correct: boolean, misconceptionId: string | null = null): RecentOutcome => ({ correct, band: 3, cold: false, misconceptionId, at: 0 });

describe("remediation (§19.6) fires exactly at its boundaries", () => {
  it("3 wrong of the last 5", () => {
    expect(shouldRemediate([r(false), r(false), r(true), r(true), r(true)], false)).toBeNull();
    expect(shouldRemediate([r(false), r(false), r(false), r(true), r(true)], false)?.cause).toBe("failure_rate");
    expect(shouldRemediate([r(false), r(false), r(false), r(true)], false)).toBeNull();
  });
  it("same misconception twice within 10", () => {
    const hist = [r(false, "m"), ...Array.from({ length: 8 }, () => r(true)), r(false, "m")];
    expect(shouldRemediate(hist, false)?.cause).toBe("repeat_misconception");
    expect(shouldRemediate([...hist.slice(0, 9), r(true), r(false, "m")], false)).toBeNull();
  });
  it("any demotion", () => {
    expect(shouldRemediate([r(true)], true)?.cause).toBe("demotion");
  });
});

describe("lesson lift", () => {
  it("is actual over predicted on the first five", () => {
    expect(lessonLift([{ p: 0.5, correct: true }, { p: 0.5, correct: false }])).toBe(1);
  });
});
