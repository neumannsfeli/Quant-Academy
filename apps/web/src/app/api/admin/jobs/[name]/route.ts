import { AppError, JOB_NAMES, runJob, type JobName } from "@qa/core";
import { api } from "@/lib/server";

/** Manual trigger for a scheduled job (admin only); production runs them from the scheduler. */
export const POST = api<{ name: string }>(
  async (_req, { params }) => {
    if (!(JOB_NAMES as readonly string[]).includes(params.name)) throw new AppError("NOT_FOUND", "no such job");
    return runJob(params.name as JobName, { force: true });
  },
  { roles: ["admin"] },
);
