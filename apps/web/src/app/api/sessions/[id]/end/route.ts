import { endSession } from "@qa/core";
import { api } from "@/lib/server";

export const POST = api<{ id: string }>(async (_req, { user, params }) => endSession(params.id, user.id));
