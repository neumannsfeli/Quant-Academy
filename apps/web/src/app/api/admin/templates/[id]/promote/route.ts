import { z } from "zod";
import { promoteTemplate } from "@qa/core";
import { api, body } from "@/lib/server";

const schema = z.object({ version: z.number().int(), changeClass: z.enum(["cosmetic", "substantive", "corrective"]).nullable(), confirm: z.string().optional() });
/** Corrective requires a typed confirmation string: that path rewrites people's scores. */
export const POST = api<{ id: string }>(async (req, { user, params }) => {
  const b = schema.parse(await body(req));
  return promoteTemplate(user.id, params.id, b.version, b.changeClass, b.confirm);
}, { roles: ["reviewer", "admin"] });
