import { z } from "zod";
import { reviewDecision, reviewQueue } from "@qa/core";
import { api, body } from "@/lib/server";

export const GET = api(async () => reviewQueue(), { roles: ["reviewer", "admin"] });
export const POST = api(async (req, { user }) => {
  const b = z.object({ id: z.string(), version: z.number().int(), decision: z.enum(["approve", "send_back", "discard"]), note: z.string().max(2000).optional() }).parse(await body(req));
  return reviewDecision(user.id, b.id, b.version, b.decision, b.note);
}, { roles: ["reviewer", "admin"] });
