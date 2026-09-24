import { buildInstance, checkpointPrompt, toClientItem, type Instance } from "@qa/items";
import { AppError } from "./errors";
import { templateKey, type Content } from "./content";
import { renderTex } from "./tex";

const cache = new Map<string, Instance>();

/** (template, version, seed) → instance. Deterministic, so safe to memoise. */
export function instanceFor(content: Content, templateId: string, version: number, seed: number): Instance {
  const key = `${templateId}@${version}#${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const row = content.templateByKey.get(templateKey(templateId, version));
  if (!row) throw new AppError("NOT_FOUND", `template ${templateId}@${version}`);
  const inst = buildInstance(row.payload, seed);
  if (cache.size > 5000) cache.clear();
  cache.set(key, inst);
  return inst;
}

export type ClientItemHtml = ReturnType<typeof clientPayload>;

/**
 * The client payload for an unanswered item: toClientItem (the one projection
 * function, tech spec §10) plus server-rendered maths.
 */
export function clientPayload(inst: Instance) {
  const item = toClientItem(inst);
  return {
    ...item,
    stemHtml: renderTex(item.stem),
    options: item.options?.map((o) => ({ ...o, html: renderTex(o.label) })),
    checkpoints: item.checkpoints?.map((c) => ({ ...c, html: renderTex(c.prompt) })),
    drill: item.drill ? { ...item.drill, items: item.drill.items.map((d) => ({ ...d, html: renderTex(d.stem) })) } : undefined,
  };
}

export function checkpointPayload(inst: Instance, index: number) {
  const c = checkpointPrompt(inst, index);
  return c ? { ...c, html: renderTex(c.prompt) } : null;
}

/** Answers shown on the answer screen: prefer the authored LaTeX display. */
export function answerHtml(inst: Instance): string {
  const d = inst.answerDisplay;
  if (inst.type === "mcq") return renderTex(d);
  if (inst.type === "symbolic" || /\\|\^|_/.test(d)) return renderTex(d.includes("$") ? d : `$${d}$`);
  return renderTex(d);
}

export const solutionHtml = (inst: Instance) => inst.solutionSteps.map((s) => renderTex(s));
