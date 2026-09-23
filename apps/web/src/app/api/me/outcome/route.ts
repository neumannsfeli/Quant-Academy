import { getHome, reportOutcome } from "@qa/core";
import { api, body } from "@/lib/server";

export const POST = api(async (req, { user }) => {
  const home = await getHome(user.id);
  return reportOutcome(user.id, await body(req), home.readiness.score);
});
