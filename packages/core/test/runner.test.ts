import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, schema as s } from "@qa/db";
import { evaluate, formatNumber } from "@qa/items";
import {
  completeLesson,
  endSession,
  getContent,
  getHome,
  getLesson,
  instanceFor,
  loadStates,
  replayUser,
  resolveFlag,
  flagItem,
  serveNext,
  setGrader,
  startSession,
  submitAnswer,
  submitStep,
  viewStep,
  attemptStep,
  deleteAccount,
  type GraderClient,
  type NextResult,
} from "../src";
import { makeUser, resetDatabase } from "./setup";

const alwaysDown: GraderClient = { grade: async () => ({ status: "unavailable", reason: "test: grader stopped" }) };
const exactMatch: GraderClient = {
  grade: async (r) => ({ status: "graded", correct: r.submitted.replace(/\s/g, "") === r.answer.replace(/\s/g, ""), method: "algebraic", normalised: r.submitted, graderVersion: "test" }),
};

async function itemRow(id: string) {
  const [row] = await getDb().select().from(s.sessionItems).where(eq(s.sessionItems.id, id));
  return row!;
}

/** The correct raw answer for a served item, computed server-side as a test oracle. */
async function correctAnswer(next: Extract<NextResult, { kind: "item" }>): Promise<string> {
  const row = await itemRow(next.sessionItemId);
  const inst = instanceFor(await getContent(), row.templateId!, row.templateVersion!, row.seed!);
  if (inst.numeric) return String(inst.numeric.answer);
  if (inst.mcq) return inst.mcq.options.find((o) => o.correct)!.id;
  if (inst.symbolic) return inst.symbolic.answerExpr;
  return "";
}

async function answerCurrent(sessionId: string, userId: string, right: boolean) {
  const next = await serveNext(sessionId, userId);
  if (next.done || next.kind !== "item") return next;
  const row = await itemRow(next.sessionItemId);
  const inst = instanceFor(await getContent(), row.templateId!, row.templateVersion!, row.seed!);
  if (inst.checkpoints) {
    for (let i = 0; i < inst.checkpoints.length; i++) {
      const c = inst.checkpoints[i]!;
      await submitStep(next.sessionItemId, userId, i, right ? String(c.answer ?? c.answerExpr) : "0.123456");
    }
  } else if (inst.drill) {
    for (let i = 0; i < inst.drill.items.length; i++) await submitStep(next.sessionItemId, userId, i, right ? String(inst.drill.items[i]!.answer) : "1");
  } else {
    await submitAnswer(next.sessionItemId, userId, right ? await correctAnswer(next) : inst.mcq ? inst.mcq.options.find((o) => !o.correct)!.id : "0.0001", 1000);
  }
  return next;
}

beforeAll(async () => {
  await resetDatabase();
  setGrader(exactMatch);
});
afterAll(async () => {
  setGrader(null);
  await closeDb();
});
beforeEach(() => setGrader(exactMatch));

describe("placement (product spec §7)", () => {
  it("serves 24 adaptive items, updates θ only, and seeds inferred skills", async () => {
    const u = await makeUser();
    const { sessionId } = await startSession(u.id, "placement");
    const bands: number[] = [];
    for (let i = 0; i < 24; i++) {
      const next = await serveNext(sessionId, u.id);
      expect(next.done).toBe(false);
      if (next.done || next.kind !== "item") throw new Error("expected an item");
      expect(["numeric", "mcq"]).toContain(next.item.type); // no symbolic/multistep/drill in placement
      bands.push(next.item.band);
      await submitAnswer(next.sessionItemId, u.id, await correctAnswer(next), 2000);
    }
    expect((await serveNext(sessionId, u.id)).done).toBe(true);
    // All correct: bands climb from 2.
    expect(bands[0]).toBe(2);
    expect(Math.max(...bands)).toBeGreaterThan(2);

    const before = await loadStates(getDb(), u.id);
    for (const st of before.values()) expect(st.level).toBe(0); // placement never grants a level
    const summary = await endSession(sessionId, u.id);
    expect(summary.placement?.domains.length).toBe(4);
    const after = await loadStates(getDb(), u.id);
    expect([...after.values()].some((st) => st.inferred)).toBe(true);
    const home = await getHome(u.id);
    expect(home.readiness.provisional).toBe(false); // 24 items, ≥5 per domain → a real number
    expect(home.readiness.score).not.toBeNull();
  });
});

describe("practice runner — hostile client suite (tech spec §12)", () => {
  it("the served payload never contains the answer", async () => {
    const u = await makeUser();
    const { sessionId } = await startSession(u.id, "practice");
    for (let i = 0; i < 6; i++) {
      const next = await serveNext(sessionId, u.id);
      if (next.done) break;
      if (next.kind !== "item") {
        await getDb().update(s.sessionItems).set({ status: "skipped" }).where(eq(s.sessionItems.id, next.sessionItemId));
        continue;
      }
      const payload = JSON.stringify(next);
      expect(payload).not.toMatch(/"correct"|misconception|answerExpr|solution|"params"|nearMiss/i);
      const ans = await correctAnswer(next);
      if (/^-?\d+(\.\d+)?$/.test(ans) && ans.length > 3) expect(payload).not.toContain(ans);
      await submitAnswer(next.sessionItemId, u.id, ans, 1000);
    }
  });

  it("a second submission returns the cached verdict and θ moves once", async () => {
    const u = await makeUser();
    const { sessionId } = await startSession(u.id, "practice");
    let next = await serveNext(sessionId, u.id);
    while (!next.done && next.kind !== "item") {
      await getDb().update(s.sessionItems).set({ status: "skipped" }).where(eq(s.sessionItems.id, next.sessionItemId));
      next = await serveNext(sessionId, u.id);
    }
    if (next.done || next.kind !== "item") throw new Error("no item");
    const row = await itemRow(next.sessionItemId);
    const inst = instanceFor(await getContent(), row.templateId!, row.templateVersion!, row.seed!);
    if (inst.checkpoints || inst.drill) return; // covered separately
    const ans = await correctAnswer(next);
    const v1 = await submitAnswer(next.sessionItemId, u.id, ans, 1000);
    const theta1 = (await loadStates(getDb(), u.id)).get(row.skillId)!.theta;
    const v2 = await submitAnswer(next.sessionItemId, u.id, "999", 1000);
    const theta2 = (await loadStates(getDb(), u.id)).get(row.skillId)!.theta;
    expect(v2).toEqual(v1);
    expect(theta2).toBe(theta1);
    const n = await getDb().select().from(s.responses).where(eq(s.responses.sessionItemId, next.sessionItemId));
    expect(n).toHaveLength(1);
  });

  it("two tabs answering the same item at once: exactly one wins", async () => {
    const u = await makeUser();
    const { sessionId } = await startSession(u.id, "practice");
    let next = await serveNext(sessionId, u.id);
    while (!next.done && next.kind !== "item") {
      await getDb().update(s.sessionItems).set({ status: "skipped" }).where(eq(s.sessionItems.id, next.sessionItemId));
      next = await serveNext(sessionId, u.id);
    }
    if (next.done || next.kind !== "item") throw new Error("no item");
    const ans = await correctAnswer(next);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => submitAnswer(next.sessionItemId, u.id, ans, 1000)));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const rows = await getDb().select().from(s.responses).where(eq(s.responses.sessionItemId, next.sessionItemId));
    expect(rows).toHaveLength(1);
  });

  it("an answer after the time limit is scored as a timeout", async () => {
    const u = await makeUser();
    const { sessionId } = await startSession(u.id, "practice");
    let next = await serveNext(sessionId, u.id);
    while (!next.done && next.kind !== "item") {
      await getDb().update(s.sessionItems).set({ status: "skipped" }).where(eq(s.sessionItems.id, next.sessionItemId));
      next = await serveNext(sessionId, u.id);
    }
    if (next.done || next.kind !== "item") throw new Error("no item");
    // Stepped items (drills) discard late answers instead; force a single-answer item.
    const content = await getContent();
    const single = [...content.templatesBySkill.values()].flat().find((t) => t.type === "numeric")!;
    const inst = instanceFor(content, single.id, single.version, 3);
    await getDb().update(s.sessionItems).set({ templateId: single.id, templateVersion: single.version, seed: 3, instanceHash: inst.instanceHash, skillId: single.skillId, band: single.band }).where(eq(s.sessionItems.id, next.sessionItemId));
    await getDb().execute(sql`update session_items set served_at = now() - interval '2 hours' where id = ${next.sessionItemId}`);
    const v = await submitAnswer(next.sessionItemId, u.id, await correctAnswer(next), 5000);
    expect(v.status).toBe("timeout");
    const [r] = await getDb().select().from(s.responses).where(eq(s.responses.sessionItemId, next.sessionItemId));
    expect(r!.timedOut).toBe(true);
    expect(r!.correct).toBe(false);
    expect(r!.timingFlag).toBe(true); // client said 5s, server measured 2h
  });

  it("a malformed number is a validation error, not a wrong answer", async () => {
    const u = await makeUser();
    for (let session = 0; session < 6; session++) {
      const { sessionId } = await startSession(u.id, "practice");
      for (let i = 0; i < 30; i++) {
        const next = await serveNext(sessionId, u.id);
        if (next.done) break;
        if (next.kind !== "item") {
          await getDb().update(s.sessionItems).set({ status: "skipped" }).where(eq(s.sessionItems.id, next.sessionItemId));
          continue;
        }
        if (next.item.type !== "numeric") {
          await answerCurrent(sessionId, u.id, true);
          continue;
        }
        await expect(submitAnswer(next.sessionItemId, u.id, "6..75", 1000)).rejects.toMatchObject({ code: "NOT_A_NUMBER" });
        expect((await itemRow(next.sessionItemId)).status).toBe("served");
        const v = await submitAnswer(next.sessionItemId, u.id, await correctAnswer(next), 1000);
        expect(v.status).toBe("correct");
        return;
      }
      await endSession(sessionId, u.id);
    }
    throw new Error("no numeric item served");
  });
});

describe("grader failover (launch criterion 7)", () => {
  it("with the grader down, a symbolic item is voided, θ is untouched and the item is requeued", async () => {
    const u = await makeUser();
    const content = await getContent();
    // Force a symbolic item: a session whose next slot is on a skill with a symbolic template.
    const { sessionId } = await startSession(u.id, "practice");
    const [sym] = [...content.templatesBySkill.values()].flat().filter((t) => t.type === "symbolic");
    const [item] = await getDb()
      .insert(s.sessionItems)
      .values({ sessionId, userId: u.id, position: 999, kind: "item", bucket: "new", skillId: sym!.skillId, templateId: sym!.id, templateVersion: sym!.version, seed: 7, instanceHash: "x", band: sym!.band, status: "served", servedAt: new Date() })
      .returning();
    const [sess] = await getDb().select().from(s.sessions).where(eq(s.sessions.id, sessionId));
    const slotsBefore = (sess!.config as { plan: { slots: unknown[] } }).plan.slots.length;
    setGrader(alwaysDown);
    const before = (await loadStates(getDb(), u.id)).get(sym!.skillId)?.theta ?? null;
    const v = await submitAnswer(item!.id, u.id, "n*k", 1000);
    expect(v.status).toBe("voided");
    expect((await itemRow(item!.id)).status).toBe("ungraded");
    const after = (await loadStates(getDb(), u.id)).get(sym!.skillId)?.theta ?? null;
    expect(after).toBe(before);
    expect(await getDb().select().from(s.responses).where(eq(s.responses.sessionItemId, item!.id))).toHaveLength(0);
    const [sess2] = await getDb().select().from(s.sessions).where(eq(s.sessions.id, sessionId));
    expect((sess2!.config as { plan: { slots: unknown[] } }).plan.slots.length).toBe(slotsBefore + 1);
  });
});

describe("multi-step and drill scoring (§8.1.1, §8.1.2)", () => {
  it("multi-step: wrong checkpoint reveals and carries; partial credit to θ, no mastery credit", async () => {
    const u = await makeUser();
    const content = await getContent();
    const ms = [...content.templatesBySkill.values()].flat().find((t) => t.type === "multistep")!;
    const { sessionId } = await startSession(u.id, "practice");
    const [item] = await getDb()
      .insert(s.sessionItems)
      .values({ sessionId, userId: u.id, position: 998, kind: "item", bucket: "new", skillId: ms.skillId, templateId: ms.id, templateVersion: ms.version, seed: 11, instanceHash: "y", band: ms.band, status: "served", servedAt: new Date() })
      .returning();
    const inst = instanceFor(content, ms.id, ms.version, 11);
    const r0 = await submitStep(item!.id, u.id, 0, "123456789");
    expect(r0.done).toBe(false);
    if (!r0.done) expect(r0.reveal).not.toBeNull();
    let last;
    for (let i = 1; i < inst.checkpoints!.length; i++) last = await submitStep(item!.id, u.id, i, String(inst.checkpoints![i]!.answer));
    expect(last!.done).toBe(true);
    const [resp] = await getDb().select().from(s.responses).where(eq(s.responses.sessionItemId, item!.id));
    expect(resp!.y).toBeCloseTo((inst.checkpoints!.length - 1) / inst.checkpoints!.length);
    expect(resp!.correct).toBe(false);
  });

  it("drill: y = k/N, one response, mastery credit at ≥ 80%", async () => {
    const u = await makeUser();
    const content = await getContent();
    const dr = [...content.templatesBySkill.values()].flat().find((t) => t.type === "drill")!;
    const { sessionId } = await startSession(u.id, "practice");
    const [item] = await getDb()
      .insert(s.sessionItems)
      .values({ sessionId, userId: u.id, position: 997, kind: "item", bucket: "new", skillId: dr.skillId, templateId: dr.id, templateVersion: dr.version, seed: 5, instanceHash: "z", band: dr.band, status: "served", servedAt: new Date() })
      .returning();
    const inst = instanceFor(content, dr.id, dr.version, 5);
    const N = inst.drill!.items.length;
    let res;
    for (let i = 0; i < N; i++) res = await submitStep(item!.id, u.id, i, i < N - 2 ? String(inst.drill!.items[i]!.answer) : "0");
    expect(res!.done).toBe(true);
    const rows = await getDb().select().from(s.responses).where(eq(s.responses.sessionItemId, item!.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.y).toBeCloseTo((N - 2) / N);
    expect(rows[0]!.setSize).toBe(N);
    expect(rows[0]!.correct).toBe((N - 2) / N >= 0.8);
  });
});

describe("lessons never move a score (§19.9, launch criterion 8)", () => {
  it("rejects /complete until every step is seen and every check answered; then Familiar, θ unchanged", async () => {
    const u = await makeUser();
    const skillId = "comb.rules";
    await expect(completeLesson(u.id, skillId)).rejects.toMatchObject({ code: "LESSON_INCOMPLETE" });
    const lesson = await getLesson(u.id, skillId);
    const content = await getContent();
    const raw = content.lessons.get(skillId)!;
    for (const st of raw.steps) {
      await viewStep(u.id, skillId, st.id);
      if (st.type === "check" && st.check.type === "numeric") {
        await attemptStep(u.id, skillId, st.id, "1"); // a wrong first try, then right
        await attemptStep(u.id, skillId, st.id, formatNumber(Number(eval0(st.check.answer))));
      }
      if (st.type === "check" && st.check.type === "mcq") {
        const opts = lesson.steps.find((x) => x.id === st.id) as { options: { id: string }[] };
        for (const o of opts.options) {
          const r = await attemptStep(u.id, skillId, st.id, o.id);
          if (r.correct) break;
        }
      }
      if (st.type === "faded") {
        for (const [i, part] of st.steps.entries()) if ("blank" in part) await attemptStep(u.id, skillId, st.id, part.blank.answer, i);
      }
    }
    const before = (await loadStates(getDb(), u.id)).get(skillId);
    const res = await completeLesson(u.id, skillId);
    expect(res.levelAfter).toBe(1);
    const after = (await loadStates(getDb(), u.id)).get(skillId)!;
    expect(after.theta).toBe(before?.theta ?? -0.5);
    expect(after.attempts).toBe(before?.attempts ?? 0);
    expect(res.entryBand).toBe(1); // every numeric check was wrong first time
  });
});

function eval0(expr: string): number {
  // Lesson answers are expressions like "choose(9, 4)"; evaluate with the item grammar.
  return evaluate(expr);
}

describe("flags, retirement and replay (§12.4, launch criterion 9)", () => {
  it("retiring an item voids its responses and replays θ as if it never happened", async () => {
    const u = await makeUser();
    const { sessionId } = await startSession(u.id, "practice");
    const answered: string[] = [];
    for (let i = 0; i < 8; i++) {
      const next = await answerCurrent(sessionId, u.id, i % 3 !== 0);
      if (next.done) break;
      if (next.kind === "item") answered.push(next.sessionItemId);
      else await getDb().update(s.sessionItems).set({ status: "skipped" }).where(eq(s.sessionItems.id, next.sessionItemId));
    }
    // Replay with nothing voided reproduces the live state exactly.
    const live = await loadStates(getDb(), u.id);
    await replayUser(u.id);
    const replayed = await loadStates(getDb(), u.id);
    for (const [k, st] of live) {
      expect(replayed.get(k)!.theta).toBeCloseTo(st.theta, 12);
      expect(replayed.get(k)!.level).toBe(st.level);
    }
    // Flag and retire the first answered item's template.
    const first = await itemRow(answered[0]!);
    await flagItem(first.id, u.id, "the answer key looks wrong");
    const [flag] = await getDb().select().from(s.flags).where(eq(s.flags.templateId, first.templateId!));
    await resolveFlag(u.id, flag!.id, "retire");
    const voided = await getDb().select().from(s.responses).where(and(eq(s.responses.templateId, first.templateId!), eq(s.responses.userId, u.id)));
    expect(voided.every((r) => r.voidedAt !== null)).toBe(true);
    const [tpl] = await getDb().select().from(s.itemTemplates).where(eq(s.itemTemplates.id, first.templateId!));
    expect(tpl!.status).toBe("retired");
  });

  it("the response log is append-only", async () => {
    const [r] = await getDb().select().from(s.responses).limit(1);
    await expect(getDb().execute(sql`update responses set correct = not correct where id = ${r!.id}`)).rejects.toThrow(/append-only/);
    await expect(getDb().execute(sql`delete from responses where id = ${r!.id}`)).rejects.toThrow(/append-only/);
  });
});

describe("account deletion (tech spec §5)", () => {
  it("deletes the user and de-identifies their responses", async () => {
    const u = await makeUser();
    const { sessionId } = await startSession(u.id, "practice");
    await answerCurrent(sessionId, u.id, true);
    const n = (await getDb().select().from(s.responses).where(eq(s.responses.userId, u.id))).length;
    await expect(deleteAccount(u.id, "wrong@example.com")).rejects.toMatchObject({ code: "VALIDATION" });
    await deleteAccount(u.id, u.email);
    expect(await getDb().select().from(s.users).where(eq(s.users.id, u.id))).toHaveLength(0);
    expect(await getDb().select().from(s.responses).where(eq(s.responses.userId, u.id))).toHaveLength(0);
    const anon = await getDb().select().from(s.responses).where(eq(s.responses.sessionId, sessionId));
    expect(anon.length).toBe(n);
  });
});
