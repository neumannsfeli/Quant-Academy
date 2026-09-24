import { z } from "zod";
import { demoAnswer, demoItem } from "@qa/core";
import { body, publicApi } from "@/lib/server";

/** The landing page's live item: nothing is stored or scored. */
export const GET = publicApi(async () => demoItem());
export const POST = publicApi(async (req) => {
  const b = z.object({ seed: z.number().int(), raw: z.string().max(64) }).parse(await body(req));
  return demoAnswer(b.seed, b.raw, req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local");
});
