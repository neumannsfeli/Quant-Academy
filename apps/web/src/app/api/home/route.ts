import { getHome } from "@qa/core";
import { api } from "@/lib/server";

/** The most-called endpoint: computed on read, never cached (tech spec §8). */
export const GET = api(async (_req, { user }) => getHome(user.id));
