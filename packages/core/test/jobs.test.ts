import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, schema as s } from "@qa/db";
import { JOB_NAMES, itemHealth, lessonHealth, runJob, serveNext, setGrader, startSession, submitAnswer } from "../src";
import { makeUser, resetDatabase } from "./setup";

// Every job and admin read model runs against a database with real activity in it —
// raw SQL fragments that bind a Date only fail at execution time, so this is the guard.
beforeAll(async () => {
  await resetDatabase();
  setGrader({ grade: async () => ({ status: "graded", correct: false, method: "test" }) } as never);
});
afterAll(async () => {
  setGrader(null);
  await closeDb();
});

describe("jobs (tech spec §4)", () => {
  it("runs every job handler to completion", async () => {
    const u = await makeUser();
    const { sessionId } = await startSession(u.id, "practice");
    for (let i = 0; i < 3; i++) {
      const next = await serveNext(sessionId, u.id);
      if (next.done || next.kind !== "item") break;
      if (next.item.type === "drill" || next.item.type === "multistep") break;
      await submitAnswer(next.sessionItemId, u.id, next.item.type === "mcq" ? next.item.options![0]!.id : "1", 1000);
    }
    await getDb().insert(s.lessonProgress).values({ userId: u.id, skillId: "comb.rules", lessonVersion: 1, status: "completed", completedAt: new Date(Date.now() - 3600_000) });

    const results: Record<string, unknown> = {};
    for (const job of JOB_NAMES) results[job] = await runJob(job, { force: true });
    expect(results.snapshots).toMatchObject({ snapshots: 1 });
    await expect(lessonHealth()).resolves.toBeInstanceOf(Array);
    await expect(itemHealth()).resolves.toHaveProperty("rows");
  });
});
