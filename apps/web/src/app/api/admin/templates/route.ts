import { listTemplates, saveTemplate } from "@qa/core";
import { api, body } from "@/lib/server";

const STAFF = ["author", "reviewer", "admin"] as const;
export const GET = api(async (req) => listTemplates({ skillId: req.nextUrl.searchParams.get("skill") ?? undefined, status: req.nextUrl.searchParams.get("status") ?? undefined }), { roles: [...STAFF] });
/** POST creates a template (or its next version); nothing live is edited in place (product spec §16.1). */
export const POST = api(async (req, { user }) => saveTemplate(user.id, await body(req)), { roles: [...STAFF] });
