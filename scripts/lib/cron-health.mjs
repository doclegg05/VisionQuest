/**
 * Verdict logic for scripts/cron-health-check.mjs — pure, no database.
 *
 * Rows in (cron.job, the latest cron.job_run_details row per job, BackgroundJob
 * aggregates) → { ok, problems[] } out. Tested in src/lib/cron-health.test.ts.
 *
 * A job is healthy when it is present in cron.job, active, has at least one
 * run, and its most recent run did not fail. An in-progress latest run
 * (pg_cron reports starting/running/sending/connecting before a terminal
 * status) is not a failure.
 */

/** The seven jobs the scheduled layer must carry (docs/plans/pg-cron-setup-runbook.md). */
export const EXPECTED_CRON_JOBS = Object.freeze([
  "appointment-reminders",
  "job-processor",
  "daily-coaching",
  "cron-health-monitor",
  "sage-daily-briefing",
  "sage-memory-consolidate",
  "sage-wager-resolve",
]);

const IN_PROGRESS_STATUSES = new Set(["starting", "running", "sending", "connecting"]);

function toIso(value) {
  if (value == null) return "unknown";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/**
 * @param {object} input
 * @param {ReadonlyArray<{ jobname: string, schedule: string, active: boolean }>} input.jobs rows from cron.job
 * @param {ReadonlyArray<{ jobname: string, status: string, start_time: Date | string | null, return_message: string | null }>} input.latestRuns one row per job, the most recent run
 * @param {ReadonlyArray<string>} [input.expected] job names to check (defaults to EXPECTED_CRON_JOBS)
 * @returns {{ ok: boolean, problems: string[], jobs: Array<object> }}
 */
export function evaluateCronHealth({ jobs, latestRuns, expected = EXPECTED_CRON_JOBS }) {
  const jobByName = new Map(jobs.map((job) => [job.jobname, job]));
  const runByName = new Map(latestRuns.map((run) => [run.jobname, run]));

  const reportRows = expected.map((jobname) => {
    const job = jobByName.get(jobname) ?? null;
    const run = runByName.get(jobname) ?? null;
    const lastRun = run
      ? {
          status: run.status,
          startTime: toIso(run.start_time),
          returnMessage: run.return_message ?? null,
        }
      : null;
    return {
      jobname,
      present: job !== null,
      active: job?.active ?? false,
      schedule: job?.schedule ?? null,
      lastRun,
      problem: describeProblem({ jobname, job, lastRun }),
    };
  });

  const problems = reportRows.flatMap((row) => (row.problem ? [row.problem] : []));
  return { ok: problems.length === 0, problems, jobs: reportRows };
}

function describeProblem({ jobname, job, lastRun }) {
  if (!job) return `${jobname}: missing from cron.job`;
  if (!job.active) return `${jobname}: registered but inactive`;
  if (!lastRun) return `${jobname}: never run`;
  if (lastRun.status === "succeeded" || IN_PROGRESS_STATUSES.has(lastRun.status)) return null;
  const message = lastRun.returnMessage ?? "(no return_message)";
  return `${jobname}: latest run ${lastRun.status} at ${lastRun.startTime}: ${message}`;
}

/**
 * Aggregate-only report lines. Nothing here carries a payload or a student
 * identifier — counts, names, schedules, timestamps, and pg_cron's own
 * return_message text.
 *
 * @param {object} input
 * @param {ReturnType<typeof evaluateCronHealth>} input.evaluation
 * @param {{ countsByStatus: ReadonlyArray<{ status: string, count: number }>, oldestPendingCreatedAt: Date | string | null }} input.backgroundJobs
 * @param {{ host: string, database: string, role: string }} input.connection
 * @param {string} input.generatedAt ISO timestamp
 * @returns {string[]}
 */
export function formatCronHealthReport({ evaluation, backgroundJobs, connection, generatedAt }) {
  const header = `cron-health-check ${generatedAt} ${connection.host}/${connection.database} role=${connection.role}`;
  const width = Math.max(...evaluation.jobs.map((row) => row.jobname.length));

  const jobLines = evaluation.jobs.map((row) => {
    const name = row.jobname.padEnd(width);
    if (!row.present) return `  ${name}  MISSING`;
    const state = row.active ? "active" : "INACTIVE";
    const last = row.lastRun ? `last=${row.lastRun.status} ${row.lastRun.startTime}` : "last=never";
    return `  ${name}  present ${state} schedule="${row.schedule}" ${last}`;
  });

  const counts = backgroundJobs.countsByStatus.map((row) => `${row.status}=${row.count}`).join(" ");
  const oldest = backgroundJobs.oldestPendingCreatedAt ? toIso(backgroundJobs.oldestPendingCreatedAt) : "none";
  const backgroundLine = `BackgroundJob: ${counts || "(no rows)"}; oldest pending createdAt=${oldest}`;

  const problemLines =
    evaluation.problems.length === 0
      ? []
      : [`PROBLEMS (${evaluation.problems.length}):`, ...evaluation.problems.map((problem) => `  - ${problem}`)];

  const verdict = evaluation.ok ? "VERDICT: OK" : "VERDICT: FAIL";

  return [header, ...jobLines, backgroundLine, ...problemLines, verdict];
}
