import { viewStep } from "@qa/core";
import { api } from "@/lib/server";

export const POST = api<{ skill: string; step: string }>(async (req, { user, params }) => viewStep(user.id, params.skill, params.step, req.nextUrl.searchParams.get("review") === "1"));
