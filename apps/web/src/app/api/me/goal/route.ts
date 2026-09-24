import { setGoal } from "@qa/core";
import { api, body } from "@/lib/server";

export const POST = api(async (req, { user }) => setGoal(user.id, await body(req)));
