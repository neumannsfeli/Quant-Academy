import type { Instance } from "./instance";

/**
 * Tech spec §10 — the ONE function that builds a client payload for an unanswered
 * item. Stem, type, option text, time limit. Never the answer, the answer
 * expression, the parameters, the solution, misconceptions, or which option is right.
 */
export type ClientItem = {
  type: Instance["type"];
  band: Instance["band"];
  stem: string;
  timeLimitSec: number;
  options?: { id: string; label: string }[];
  variables?: string[];
  checkpoints?: { index: number; prompt: string; kind: "numeric" | "symbolic"; variables?: string[] }[];
  drill?: { count: number; totalSec: number; items: { index: number; stem: string }[] };
};

export function toClientItem(instance: Instance): ClientItem {
  const item: ClientItem = {
    type: instance.type,
    band: instance.band,
    stem: instance.stem,
    timeLimitSec: instance.timeLimitSec,
  };
  if (instance.mcq) item.options = instance.mcq.options.map(({ id, label }) => ({ id, label }));
  if (instance.symbolic) item.variables = [...instance.symbolic.variables];
  if (instance.checkpoints) {
    // Multi-step checkpoints are disclosed one at a time; the runner asks for the next.
    item.checkpoints = instance.checkpoints.slice(0, 1).map((c, index) => ({
      index,
      prompt: c.prompt,
      kind: c.kind,
      ...(c.variables ? { variables: [...c.variables] } : {}),
    }));
  }
  if (instance.drill) {
    item.drill = {
      count: instance.drill.items.length,
      totalSec: instance.drill.totalSec,
      items: instance.drill.items.map((it, index) => ({ index, stem: it.stem })),
    };
  }
  return item;
}

export function checkpointPrompt(instance: Instance, index: number) {
  const c = instance.checkpoints?.[index];
  if (!c) return null;
  return { index, prompt: c.prompt, kind: c.kind, ...(c.variables ? { variables: [...c.variables] } : {}) };
}
