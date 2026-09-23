import { getSkillPage } from "@qa/core";
import { api } from "@/lib/server";

export const GET = api<{ slug: string }>(async (_req, { user, params }) => getSkillPage(user.id, params.slug));
