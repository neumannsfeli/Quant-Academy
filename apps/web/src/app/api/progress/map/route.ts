import { getProgressMap } from "@qa/core";
import { api } from "@/lib/server";

export const GET = api(async (_req, { user }) => getProgressMap(user.id));
