import { z } from "zod";
import { deleteAccount, getMe, updateMe } from "@qa/core";
import { signOut } from "@/auth";
import { api, body } from "@/lib/server";

export const GET = api(async (_req, { user }) => getMe(user.id));
export const PATCH = api(async (req, { user }) => updateMe(user.id, await body(req)));
export const DELETE = api(async (req, { user }) => {
  const { confirm } = z.object({ confirm: z.string() }).parse(await body(req));
  await deleteAccount(user.id, confirm);
  await signOut({ redirect: false }).catch(() => {});
  return { ok: true };
});
