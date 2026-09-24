import { z } from "zod";
import { flagQueue, resolveFlag } from "@qa/core";
import { api, body } from "@/lib/server";

export const GET = api(async () => flagQueue(), { roles: ["reviewer", "admin"] });
export const POST = api(async (req, { user }) => {
  const b = z.object({ id: z.string(), action: z.enum(["dismiss", "retire", "edit"]) }).parse(await body(req));
  return resolveFlag(user.id, b.id, b.action);
}, { roles: ["reviewer", "admin"] });
