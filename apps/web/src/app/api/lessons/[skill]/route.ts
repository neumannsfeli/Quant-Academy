import { getLesson } from "@qa/core";
import { api } from "@/lib/server";

export const GET = api<{ skill: string }>(async (_req, { user, params }) => getLesson(user.id, params.skill));
