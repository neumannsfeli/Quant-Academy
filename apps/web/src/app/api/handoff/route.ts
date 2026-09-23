import { z } from "zod";
import { desktopHandoff } from "@qa/core";
import { body, publicApi } from "@/lib/server";

export const POST = publicApi(async (req) => {
  const { email } = z.object({ email: z.string() }).parse(await body(req));
  return desktopHandoff(email, req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local");
});
