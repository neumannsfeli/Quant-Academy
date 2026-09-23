import { z } from "zod";
import { previewSeeds } from "@qa/core";
import { templateSchema } from "@qa/db/content-schema";
import type { ItemTemplate } from "@qa/items";
import { api, body } from "@/lib/server";

/** Live preview for the editor: five seeds side by side, from an unsaved payload. */
export const POST = api(async (req) => {
  const b = z.object({ payload: z.unknown(), seeds: z.array(z.number().int()).max(10).optional() }).parse(await body(req));
  const parsed = templateSchema.safeParse(b.payload);
  if (!parsed.success) return { ok: false, error: `${parsed.error.issues[0]!.path.join(".")}: ${parsed.error.issues[0]!.message}` };
  return { ok: true, previews: previewSeeds(parsed.data as unknown as ItemTemplate, b.seeds ?? [1, 2, 3, 4, 5]) };
}, { roles: ["author", "reviewer", "admin"] });
