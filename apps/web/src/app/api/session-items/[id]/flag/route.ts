import { z } from "zod";
import { flagItem } from "@qa/core";
import { api, body } from "@/lib/server";

const schema = z.object({ note: z.string().max(2000).nullable().optional() });
export const POST = api<{ id: string }>(async (req, { user, params }) => flagItem(params.id, user.id, schema.parse(await body(req)).note ?? null));
