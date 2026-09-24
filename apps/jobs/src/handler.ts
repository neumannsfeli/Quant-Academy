/**
 * Tech spec §4, §16.3 item 5 — one handler for every scheduled job. Option A invokes it
 * from EventBridge Scheduler (one Lambda, one schedule per job); Option B from an SQS
 * consumer. The job name and payload arrive in the event; nothing here keeps state.
 */
import { JOB_NAMES, runJob, type JobName, type JobPayload } from "@qa/core";

export type JobEvent = { job: string; payload?: JobPayload };

export async function handler(event: JobEvent): Promise<Record<string, unknown>> {
  if (!(JOB_NAMES as readonly string[]).includes(event.job)) throw new Error(`unknown job "${event.job}"`);
  const started = Date.now();
  const result = await runJob(event.job as JobName, event.payload ?? {});
  // One structured line per invocation: this is what the job's alarm and log query read.
  console.log(JSON.stringify({ job: event.job, ms: Date.now() - started, ...result }));
  return result;
}

/** Production schedules, as EventBridge rate/cron expressions (UTC). */
export const SCHEDULES: Record<JobName, string> = {
  sweeper: "rate(5 minutes)",
  snapshots: "cron(0 * * * ? *)", // hourly; each user's snapshot is written at 03:00 local
  "daily-plan": "cron(0 * * * ? *)", // hourly; sent at 08:00 local
  "weekly-summary": "cron(0 * * * ? *)", // hourly; Sunday 18:00 local
  "outcome-ask": "cron(30 9 * * ? *)",
  "stats-rollup": "cron(15 2 * * ? *)",
  cleanup: "cron(45 3 * * ? *)",
};
