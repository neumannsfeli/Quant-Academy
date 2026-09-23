import { getTemplate, saveTemplate } from "@qa/core";
import { api, body } from "@/lib/server";

const STAFF = ["author", "reviewer", "admin"] as const;
export const GET = api<{ id: string }>(async (_req, { params }) => getTemplate(params.id), { roles: [...STAFF] });
export const PATCH = api<{ id: string }>(async (req, { user, params }) => saveTemplate(user.id, { ...(await body(req)), id: params.id }), { roles: [...STAFF] });
