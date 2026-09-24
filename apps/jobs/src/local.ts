/**
 * Local runner for the job handlers — the stand-in for EventBridge in development.
 *   pnpm --filter @qa/jobs once <job> [--force] [--now=ISO]
 *   pnpm --filter @qa/jobs schedule          (runs each job on its production cadence)
 * Never run the scheduler inside the web process: two web containers would run every job twice.
 */
import { existsSync } from "node:fs";
import { JOB_NAMES, type JobName } from "@qa/core";
import { closeDb } from "@qa/db";
import { handler } from "./handler";

const rootEnv = new URL("../../../.env", import.meta.url).pathname;
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const [mode, name, ...flags] = process.argv.slice(2);
const opt = (k: string) => flags.find((f) => f === `--${k}` || f.startsWith(`--${k}=`));

if (mode === "once") {
  if (!name) {
    console.error(`usage: once <job> [--force] [--now=ISO]\njobs: ${JOB_NAMES.join(", ")}`);
    process.exit(2);
  }
  const now = opt("now")?.split("=")[1];
  try {
    await handler({ job: name, payload: { force: !!opt("force"), ...(now ? { now } : {}) } });
  } finally {
    await closeDb();
  }
} else if (mode === "schedule") {
  const MIN = 60_000;
  const cadence: Record<JobName, number> = {
    sweeper: 5 * MIN,
    snapshots: 60 * MIN,
    "daily-plan": 60 * MIN,
    "weekly-summary": 60 * MIN,
    "outcome-ask": 24 * 60 * MIN,
    "stats-rollup": 24 * 60 * MIN,
    cleanup: 24 * 60 * MIN,
  };
  const run = (job: JobName) => handler({ job }).catch((e) => console.error(JSON.stringify({ job, error: (e as Error).message })));
  for (const job of JOB_NAMES) {
    void run(job);
    setInterval(() => void run(job), cadence[job]);
  }
  console.log(`scheduler running ${JOB_NAMES.length} jobs; Ctrl-C to stop`);
} else {
  console.error("usage: local.ts once <job> | schedule");
  process.exit(2);
}
