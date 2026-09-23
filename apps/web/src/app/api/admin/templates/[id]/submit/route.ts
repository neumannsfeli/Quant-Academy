import { z } from "zod";
import { submitForReview } from "@qa/core";
import { api, body } from "@/lib/server";

export const POST = api<{ id: string }>(async (req, { params }) => submitForReview(params.id, z.object({ version: z.number().int() }).parse(await body(req)).version), { roles: ["author", "reviewer", "admin"] });
