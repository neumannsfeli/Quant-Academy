import { runJob, type JobName } from "@qa/core";
import { api } from "@/lib/server";

/** Manual trigger for a scheduled job (admin only); production runs them from the scheduler. */
export const POST = api<{ name: JobName }>(async (_req, { params }) => runJob(params.name, { force: true }), { roles: ["admin"] });
