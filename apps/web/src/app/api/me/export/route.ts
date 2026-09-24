import { requestExport } from "@qa/core";
import { api } from "@/lib/server";

/** Enqueues a CSV export and emails a link that expires in an hour (tech spec §10). */
export const POST = api(async (_req, { user }) => requestExport(user.id));
