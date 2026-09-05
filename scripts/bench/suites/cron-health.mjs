/**
 * bench suite: cron-health (config/benchmarks/cron-health.json)
 *
 * Wraps the exact verdict logic the nightly cron-health.yml workflow gates
 * on — `evaluateCronHealth()` in scripts/lib/cron-health.mjs, run via the
 * importable core `runCronHealthCheck()` this session added to
 * scripts/cron-health-check.mjs — rather than a second copy of that logic.
 * `expected_jobs_healthy` is the fraction of the 7 EXPECTED_CRON_JOBS
 * (scripts/lib/cron-health.mjs) that are present, active, and last
 * succeeded; `pending_background_jobs` is the current BackgroundJob
 * "pending" count, reported as info because its disposition is an owner
 * call (D4 in .claude/MEMORY.md), not a floor this suite can set.
 *
 * Needs prod-readonly: BENCH_PROD_READONLY_URL, or CRON_CHECK_DATABASE_URL
 * (the secret cron-health.yml already uses) as a fallback — the postgres
 * role, since cron.job is invisible to vq_app and BackgroundJob is
 * RLS-protected (F63 class: prismaAdmin regressing to the app role must
 * never look like "all clear" here).
 */

import { EXPECTED_CRON_JOBS } from "../../lib/cron-health.mjs";
import { runCronHealthCheck } from "../../cron-health-check.mjs";
import { isMainModule, runSelfTest } from "./ops-shared.mjs";

/**
 * Pure mapping from evaluateCronHealth()'s output to this suite's two
 * metrics, tested without a database in cron-health.test.mjs.
 *
 * @param {ReturnType<typeof import("../../lib/cron-health.mjs").evaluateCronHealth>} evaluation
 * @param {{ countsByStatus: ReadonlyArray<{ status: string, count: number }>, oldestPendingCreatedAt: unknown }} backgroundJobs
 * @param {ReadonlyArray<string>} expected the EXPECTED_CRON_JOBS list (a parameter so the test can pin a small fixture list rather than depend on the repo's current job count)
 */
export function toMetrics(evaluation, backgroundJobs, expected) {
  const healthyCount = evaluation.jobs.filter((job) => job.problem === null).length;
  const pendingCount = backgroundJobs.countsByStatus.find((row) => row.status === "pending")?.count ?? 0;

  return {
    metrics: [
      {
        id: "expected_jobs_healthy",
        value: healthyCount / expected.length,
        n: expected.length,
        details: {
          jobs: evaluation.jobs.map((job) => ({
            jobname: job.jobname,
            present: job.present,
            active: job.active,
            problem: job.problem,
          })),
          httpResponses: evaluation.httpResponses,
          problems: evaluation.problems,
        },
      },
      {
        id: "pending_background_jobs",
        value: pendingCount,
        details: {
          countsByStatus: backgroundJobs.countsByStatus,
          oldestPendingCreatedAt: backgroundJobs.oldestPendingCreatedAt,
        },
      },
    ],
  };
}

/** @param {object} ctx @returns {Promise<{ metrics: Array<object> }>} */
export async function run(ctx) {
  const url = ctx.env.databaseUrl;
  if (!url) {
    throw new Error(
      "cron-health requires prod-readonly: set BENCH_PROD_READONLY_URL (or CRON_CHECK_DATABASE_URL)."
    );
  }

  const { evaluation, backgroundJobs } = await runCronHealthCheck(url);
  return toMetrics(evaluation, backgroundJobs, EXPECTED_CRON_JOBS);
}

function checkRequires(ctx) {
  if (!ctx.env.databaseUrl) {
    return "no prod-readonly connection string (BENCH_PROD_READONLY_URL or CRON_CHECK_DATABASE_URL not set)";
  }
  return null;
}

if (isMainModule(import.meta.url) && process.argv.includes("--self-test")) {
  runSelfTest({
    suiteName: "cron-health",
    configPath: "config/benchmarks/cron-health.json",
    run,
    checkRequires,
  }).then((code) => {
    process.exitCode = code;
  });
}
