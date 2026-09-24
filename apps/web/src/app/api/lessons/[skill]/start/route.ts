import { startLesson } from "@qa/core";
import { api } from "@/lib/server";

export const POST = api<{ skill: string }>(async (_req, { user, params }) => startLesson(user.id, params.skill));
