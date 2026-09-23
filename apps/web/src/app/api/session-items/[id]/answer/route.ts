import { z } from "zod";
import { submitAnswer } from "@qa/core";
import { api, body } from "@/lib/server";

const schema = z.object({ raw: z.string().max(512), clientElapsedMs: z.number().int().nonnegative().nullable().optional() });

export const POST = api<{ id: string }>(async (req, { user, params }) => {
  const b = schema.parse(await body(req));
  return submitAnswer(params.id, user.id, b.raw, b.clientElapsedMs ?? null);
});
