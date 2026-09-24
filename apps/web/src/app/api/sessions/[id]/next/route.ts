import { serveNext } from "@qa/core";
import { api } from "@/lib/server";

/** POST, not GET: serving starts the clock, so it must never be prefetched or retried by a proxy (tech spec §8). */
export const POST = api<{ id: string }>(async (_req, { user, params }) => serveNext(params.id, user.id));
