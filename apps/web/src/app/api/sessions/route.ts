import { z } from "zod";
import { startSession } from "@qa/core";
import { api, body } from "@/lib/server";

const schema = z.object({ mode: z.enum(["practice", "placement", "assessment", "review"]).default("practice"), skillId: z.string().max(200).optional() });

/** POST /api/sessions — compose a session (product spec §10.1), or resume the open one. */
export const POST = api(async (req, { user }) => {
  const b = schema.parse(await body(req));
  return startSession(user.id, b.mode, new Date(), { skillId: b.mode === "practice" ? b.skillId : undefined });
});
