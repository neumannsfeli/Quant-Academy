import { z } from "zod";
import { hintStep } from "@qa/core";
import { api, body } from "@/lib/server";

const schema = z.object({ index: z.number().int().min(0).max(5), part: z.number().int().min(0).optional() });
export const POST = api<{ skill: string; step: string }>(async (req, { user, params }) => {
  const b = schema.parse(await body(req));
  return hintStep(user.id, params.skill, params.step, b.index, b.part);
});
