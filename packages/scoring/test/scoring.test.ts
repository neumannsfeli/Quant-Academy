import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BAND_PRIORS,
  KU_SCHEDULE,
  applyResponse,
  applyToUser,
  blendReadiness,
  initialSkillState,
  nextDueAt,
  predictP,
  readiness,
  replay,
  retention,
  reviewIntervalDays,
  S_MAX_DAYS,
  S_MIN_DAYS,
  type Band,
  type Outcome,
  type SkillMeta,
  type SkillState,
  type StoredEvent,
} from "../src";

const DAY = 86_400_000;
const T0 = new Date("2026-01-01T00:00:00Z");

const band = fc.constantFrom<Band>(1, 2, 3, 4, 5);
const outcomeArb: fc.Arbitrary<Outcome> = fc
  .record({
    correct: fc.boolean(),
    band,
    b: fc.double({ min: -3, max: 3, noNaN: true }),
    timedOut: fc.boolean(),
    withinLimit: fc.boolean(),
    seenBefore: fc.boolean(),
    itemResponseCount: fc.integer({ min: 0, max: 500 }),
    mode: fc.constantFrom("practice", "practice", "assessment", "placement") as fc.Arbitrary<Outcome["mode"]>,
  })
  .map((o) => ({ ...o, y: o.correct ? 1 : 0, timedOut: o.correct ? false : o.timedOut }));

const historyArb = fc.array(
  fc.record({ outcome: outcomeArb, gapHours: fc.integer({ min: 0, max: 24 * 40 }) }),
  { maxLength: 40 },
);

function run(history: { outcome: Outcome; gapHours: number }[]) {
  let s = initialSkillState();
  let t = T0.getTime();
  const trace: { before: SkillState; after: SkillState; outcome: Outcome; at: Date }[] = [];
  for (const h of history) {
    t += h.gapHours * 3_600_000;
    const at = new Date(t);
    const { state } = applyResponse(s, h.outcome, at);
    trace.push({ before: s, after: state, outcome: h.outcome, at });
    s = state;
  }
  return { final: s, trace };
}

describe("published constants (product spec §20)", () => {
  it("band priors", () => {
    expect(BAND_PRIORS).toEqual({ 1: -1.2, 2: -0.4, 3: 0.4, 4: 1.2, 5: 2.0 });
  });
  it("Kᵤ schedule", () => {
    expect(KU_SCHEDULE.map((s) => s.k)).toEqual([0.6, 0.35, 0.2]);
  });
  it("first review lands about one day after S₀", () => {
    expect(reviewIntervalDays(6)).toBeCloseTo(0.975, 2);
  });
  it("ladder 1 → 2.3 → 5.3 → 12 → 28 → 64 → 148 days", () => {
    const ladder = [6, 13.8, 31.74, 73.0, 167.9].map((s) => reviewIntervalDays(s));
    expect(ladder.map((d) => Math.round(d * 10) / 10)).toEqual([1, 2.2, 5.2, 11.9, 27.3]);
  });
});

describe("θ update properties (tech spec §12)", () => {
  it("θ moves up on correct, down on incorrect", () => {
    fc.assert(
      fc.property(historyArb, outcomeArb, (h, o) => {
        const { final } = run(h);
        const { state } = applyResponse(final, o, new Date(T0.getTime() + 1e10));
        if (o.y === 1) expect(state.theta).toBeGreaterThan(final.theta);
        else expect(state.theta).toBeLessThan(final.theta);
      }),
    );
  });

  it("|Δθ| ≤ Kᵤ always", () => {
    fc.assert(
      fc.property(historyArb, outcomeArb, (h, o) => {
        const { final } = run(h);
        const { delta } = applyResponse(final, o, new Date(T0.getTime() + 1e10));
        expect(Math.abs(delta.thetaAfter - delta.thetaBefore)).toBeLessThanOrEqual(0.6 + 1e-12);
      }),
    );
  });

  it("b moves opposite to θ", () => {
    fc.assert(
      fc.property(outcomeArb, (o) => {
        const { delta } = applyResponse(initialSkillState(), o, T0);
        if (o.y === 1) expect(delta.bAfter).toBeLessThan(delta.bBefore);
        else expect(delta.bAfter).toBeGreaterThan(delta.bBefore);
      }),
    );
  });
});

describe("retention and stability", () => {
  it("r is in [0,1] and monotonically decreasing in elapsed time", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 2, max: 180, noNaN: true }),
        fc.double({ min: 0, max: 400, noNaN: true }),
        fc.double({ min: 0, max: 400, noNaN: true }),
        (S, a, b) => {
          const st = { lastCorrectAt: T0, stabilityS: S };
          const ra = retention(st, new Date(T0.getTime() + Math.min(a, b) * DAY))!;
          const rb = retention(st, new Date(T0.getTime() + Math.max(a, b) * DAY))!;
          expect(ra).toBeGreaterThanOrEqual(0);
          expect(ra).toBeLessThanOrEqual(1);
          expect(rb).toBeLessThanOrEqual(ra);
        },
      ),
    );
  });

  it("stability stays within [2, 180]", () => {
    fc.assert(
      fc.property(historyArb, (h) => {
        for (const step of run(h).trace) {
          expect(step.after.stabilityS).toBeGreaterThanOrEqual(S_MIN_DAYS);
          expect(step.after.stabilityS).toBeLessThanOrEqual(S_MAX_DAYS);
        }
      }),
    );
  });

  it("interview date caps the interval at half the remaining days", () => {
    const st = { lastCorrectAt: T0, stabilityS: 150 };
    const due = nextDueAt(st, T0, new Date(T0.getTime() + 20 * DAY))!;
    expect((due.getTime() - T0.getTime()) / DAY).toBeCloseTo(10, 6);
    const lifted = nextDueAt(st, T0, new Date(T0.getTime() - DAY))!;
    expect((lifted.getTime() - T0.getTime()) / DAY).toBeCloseTo(reviewIntervalDays(150), 6);
  });
});

describe("levels (product spec §5)", () => {
  it("Level 3 is never reached without three consecutive cold successes at band ≥ 3", () => {
    fc.assert(
      fc.property(historyArb, (h) => {
        for (const step of run(h).trace) {
          if (step.after.level === 3 && step.before.level < 3) {
            const last3 = step.after.recent.slice(0, 3);
            expect(last3.length).toBe(3);
            for (const r of last3) {
              expect(r.cold).toBe(true);
              expect(r.band).toBeGreaterThanOrEqual(3);
            }
          }
        }
      }),
    );
  });

  it("placement never changes level, streak or stability", () => {
    fc.assert(
      fc.property(historyArb, outcomeArb, (h, o) => {
        const { final } = run(h);
        const { state } = applyResponse(final, { ...o, mode: "placement" }, new Date(T0.getTime() + 1e10));
        expect(state.level).toBe(final.level);
        expect(state.coldStreak).toBe(final.coldStreak);
        expect(state.stabilityS).toBe(final.stabilityS);
        expect(state.lastCorrectAt).toBe(final.lastCorrectAt);
      }),
    );
  });

  it("decay alone never demotes", () => {
    fc.assert(
      fc.property(historyArb, (h) => {
        for (const step of run(h).trace) {
          if (step.after.level < step.before.level) {
            expect(step.outcome.correct).toBe(false);
            expect(step.outcome.band).toBeGreaterThanOrEqual(3);
          }
        }
      }),
    );
  });

  it("walks a user from Unseen to Interview-ready", () => {
    let s = initialSkillState(0.3);
    const o = (band: Band): Outcome => ({
      y: 1, correct: true, band, b: BAND_PRIORS[band], timedOut: false, withinLimit: true,
      seenBefore: false, itemResponseCount: 100, mode: "practice",
    });
    let t = T0.getTime();
    const levels: number[] = [];
    for (const b of [2, 3, 3, 3, 3] as Band[]) {
      t += 3_600_000;
      s = applyResponse(s, o(b), new Date(t)).state;
      levels.push(s.level);
    }
    // band 2 opens Familiar; three cold band-3 successes then prove it cold
    expect(levels).toEqual([1, 1, 2, 3, 3]);
    // one failure at band 3 → Working, streak reset
    s = applyResponse(s, { ...o(3), y: 0, correct: false }, new Date(t + 3_600_000)).state;
    expect(s.level).toBe(2);
    expect(s.coldStreak).toBe(0);
  });
});

describe("readiness (product spec §6)", () => {
  it("reproduces the worked example: 82/61/55/24 → 44", () => {
    const { raw, mean, power } = blendReadiness([
      { weight: 0.4, value: 82 },
      { weight: 0.25, value: 61 },
      { weight: 0.2, value: 55 },
      { weight: 0.15, value: 24 },
    ]);
    expect(mean).toBeCloseTo(62.7, 1);
    expect(power).toBeCloseTo(37.6, 0);
    expect(Math.round(raw)).toBe(44);
  });

  it("is bounded below by the weakest domain and above by the mean", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ weight: fc.double({ min: 0.05, max: 1, noNaN: true }), value: fc.double({ min: 1, max: 100, noNaN: true }) }), { minLength: 1, maxLength: 6 }),
        (ds) => {
          const { raw, mean } = blendReadiness(ds);
          const min = Math.min(...ds.map((d) => d.value));
          expect(raw).toBeGreaterThanOrEqual(min - 1e-9);
          expect(raw).toBeLessThanOrEqual(mean + 1e-9);
        },
      ),
    );
  });

  it("is provisional until 20 attempts and 5 per domain", () => {
    const skills: SkillMeta[] = [
      { id: "a", domainId: "d1", importance: 2, prereqIds: [] },
      { id: "b", domainId: "d2", importance: 2, prereqIds: [] },
    ];
    const arch = { id: "x", weights: { d1: 0.5, d2: 0.5 }, required: { a: 3 as Band, b: 3 as Band } };
    const st = (attempts: number): SkillState => ({ ...initialSkillState(0.5), attempts });
    expect(readiness({ a: st(19), b: st(0) }, skills, arch, T0).score).toBeNull();
    expect(readiness({ a: st(16), b: st(4) }, skills, arch, T0).score).toBeNull();
    expect(readiness({ a: st(15), b: st(5) }, skills, arch, T0).score).not.toBeNull();
  });
});

describe("replay (the most important test in the suite)", () => {
  const skills: SkillMeta[] = [
    { id: "root", domainId: "d", importance: 2, prereqIds: [] },
    { id: "mid", domainId: "d", importance: 2, prereqIds: ["root"] },
    { id: "top", domainId: "d", importance: 2, prereqIds: ["mid", "root"] },
  ];
  const meta = new Map(skills.map((s) => [s.id, s]));

  it("replay(responses) equals applying them one at a time", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ skillId: fc.constantFrom("root", "mid", "top"), outcome: outcomeArb, gap: fc.integer({ min: 1, max: 1e8 }) }), { maxLength: 50 }),
        (rs) => {
          let t = T0.getTime();
          const events: StoredEvent[] = rs.map((r) => {
            t += r.gap;
            return { kind: "response", skillId: r.skillId, outcome: r.outcome, at: new Date(t) };
          });
          const live = new Map<string, SkillState>();
          for (const e of events) if (e.kind === "response") applyToUser(live, meta, e);
          const replayed = replay([...events].reverse(), skills);
          expect(replayed).toEqual(live);
        },
      ),
    );
  });

  it("propagates 15% of the update to direct prerequisites on a correct answer only", () => {
    const states = new Map<string, SkillState>();
    const o: Outcome = { y: 1, correct: true, band: 3, b: 0.4, timedOut: false, withinLimit: true, seenBefore: false, itemResponseCount: 100, mode: "practice" };
    const r = applyToUser(states, meta, { skillId: "top", outcome: o, at: T0 });
    const expected = -0.5 + 0.15 * r.delta.ku * (1 - r.delta.p);
    expect(states.get("mid")!.theta).toBeCloseTo(expected, 12);
    const before = new Map(states);
    applyToUser(states, meta, { skillId: "top", outcome: { ...o, y: 0, correct: false }, at: new Date(T0.getTime() + 1000) });
    expect(states.get("mid")).toEqual(before.get("mid"));
  });
});

describe("predictP", () => {
  it("is 0.5 at θ = b", () => expect(predictP(1, 1)).toBe(0.5));
});
