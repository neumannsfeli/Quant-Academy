import { z } from "zod";
import { flagLessonStep } from "@qa/core";
import { api, body } from "@/lib/server";

export const POST = api<{ skill: string; step: string }>(async (req, { user, params }) => flagLessonStep(user.id, params.skill, params.step, z.object({ note: z.string().max(2000).nullable().optional() }).parse(await body(req)).note ?? null));
