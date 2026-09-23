/**
 * The landing page's live item (frame 07): one real template, a fresh seed per page
 * load, graded by the same checker as practice. Nothing is stored or scored; the
 * seed is public, so there is nothing to protect beyond the usual rate limit.
 */
import { randomInt } from "node:crypto";
import { getContent } from "./content";
import { AppError } from "./errors";
import { gradeMain } from "./grading";
import { answerHtml, clientPayload, instanceFor, solutionHtml } from "./instances";
import { rateLimit } from "./ratelimit";
import { renderInline } from "./tex";

export const DEMO_TEMPLATE = "prob.order-stats.b3.dice-max";

async function demoTemplate() {
  const content = await getContent();
  const rows = [...content.templateByKey.values()].filter((t) => t.id === DEMO_TEMPLATE).sort((a, b) => b.version - a.version);
  if (!rows[0]) throw new AppError("NOT_FOUND", "demo item unavailable");
  return { content, row: rows[0] };
}

export async function demoItem(seed = randomInt(1, 10_000)) {
  const { content, row } = await demoTemplate();
  const inst = instanceFor(content, row.id, row.version, seed);
  const p = clientPayload(inst);
  return { seed, band: row.band, type: inst.type, stemHtml: p.stemHtml };
}

export async function demoAnswer(seed: number, raw: string, subject: string) {
  await rateLimit("answer", `demo:${subject}`);
  if (!Number.isInteger(seed) || seed < 1 || seed > 10_000) throw new AppError("VALIDATION", "bad seed");
  const { content, row } = await demoTemplate();
  const inst = instanceFor(content, row.id, row.version, seed);
  const g = await gradeMain(inst, raw);
  if (g.kind === "void") throw new AppError("GRADER_UNAVAILABLE");
  const mc = g.misconceptionId ? content.misconceptions.get(g.misconceptionId) : null;
  return {
    correct: g.correct,
    answerHtml: answerHtml(inst),
    solutionHtml: solutionHtml(inst),
    misconception: mc ? { id: mc.id, label: mc.label, explanationHtml: renderInline(mc.explanation) } : null,
  };
}
