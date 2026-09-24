import { completeLesson } from "@qa/core";
import { api } from "@/lib/server";

export const POST = api<{ skill: string }>(async (_req, { user, params }) => completeLesson(user.id, params.skill));
