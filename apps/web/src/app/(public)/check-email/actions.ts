"use server";

import { z } from "zod";
import { signIn } from "@/auth";

export async function resend(email: string) {
  const parsed = z.string().email().safeParse(email);
  if (!parsed.success) return { ok: false };
  await signIn("email", { email: parsed.data, redirect: false, redirectTo: "/onboarding" }).catch(() => undefined);
  return { ok: true };
}
