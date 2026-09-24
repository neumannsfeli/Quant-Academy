import { z } from "zod";
import { attemptStep } from "@qa/core";
import { api, body } from "@/lib/server";

const schema = z.object({ raw: z.string().max(512), part: z.number().int().min(0).optional() });
export const POST = api<{ skill: string; step: string }>(async (req, { user, params }) => {
  const b = schema.parse(await body(req));
  return attemptStep(user.id, params.skill, params.step, b.raw, b.part);
});
