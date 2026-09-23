import { getProgressHistory } from "@qa/core";
import { api } from "@/lib/server";

export const GET = api(async (req, { user }) => getProgressHistory(user.id, Math.min(365, Number(req.nextUrl.searchParams.get("days") ?? 90))));
