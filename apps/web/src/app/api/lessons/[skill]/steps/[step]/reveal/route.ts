import { z } from "zod";
import { revealStep } from "@qa/core";
import { api, body } from "@/lib/server";

const schema = z.object({ part: z.number().int().min(0).optional() });
export const POST = api<{ skill: string; step: string }>(async (req, { user, params }) => revealStep(user.id, params.skill, params.step, schema.parse(await body(req)).part));
