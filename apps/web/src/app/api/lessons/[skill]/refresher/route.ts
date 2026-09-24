import { z } from "zod";
import { finishRefresher, getRefresher } from "@qa/core";
import { api, body } from "@/lib/server";

export const GET = api<{ skill: string }>(async (_req, { user, params }) => getRefresher(user.id, params.skill));
export const POST = api<{ skill: string }>(async (req, { user, params }) => finishRefresher(user.id, params.skill, z.object({ resolution: z.enum(["completed", "skipped"]) }).parse(await body(req)).resolution));
