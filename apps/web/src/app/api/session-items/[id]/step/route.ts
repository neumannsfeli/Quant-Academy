import { z } from "zod";
import { submitStep } from "@qa/core";
import { api, body } from "@/lib/server";

const schema = z.object({ index: z.number().int().min(0).max(200), raw: z.string().max(512) });

/** Multi-step checkpoints and drill sub-items; same claim semantics, per step (tech spec §8). */
export const POST = api<{ id: string }>(async (req, { user, params }) => {
  const b = schema.parse(await body(req));
  return submitStep(params.id, user.id, b.index, b.raw);
});
