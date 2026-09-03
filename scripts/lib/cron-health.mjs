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
 *
 * cron.job_run_details cannot see HTTP outcomes: net.http_post/http_get are
 * asynchronous, so a run is recorded succeeded whether the app answered 200,
 * 401, 404, or 500. The outcome lives in net._http_response for pg_net's ttl
 * (default 6 hours). Any non-200, errored, or timed-out row in that window is
 * a problem; an absent or unreadable table is reported but is not a failure
 * on its own.
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

/** pg_net's default ttl for net._http_response rows; the window the check reads. */
export const HTTP_RESPONSE_WINDOW_HOURS = 6;

const HTTP_NOT_QUERIED = Object.freeze({ available: false, reason: "not queried" });

function toIso(value) {
  if (value == null) return "unknown";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/**
 * @typedef {object} LastRun
 * @property {string} status pg_cron run status (succeeded, failed, starting, running, ...)
 * @property {string} startTime ISO timestamp
 * @property {string | null} returnMessage
 */

/**
 * @typedef {object} HttpResponseRow
 * @property {number | bigint} id
 * @property {number | null} status_code
 * @property {string | null} error_msg
 * @property {boolean | null} timed_out
 * @property {Date | string} created
 */

/**
 * @typedef {{ available: true, windowHours: number, rows: ReadonlyArray<HttpResponseRow> } | { available: false, reason: string }} HttpResponsesInput
 * @typedef {{ available: true, windowHours: number, total: number, failed: number } | { available: false, reason: string }} HttpResponsesSummary
 */

/**
 * @typedef {object} CronJobReportRow
 * @property {string} jobname
 * @property {boolean} present
 * @property {boolean} active
 * @property {string | null} schedule
 * @property {LastRun | null} lastRun
 * @property {string | null} problem
 */

/**
 * @param {object} input
 * @param {ReadonlyArray<{ jobname: string, schedule: string, active: boolean }>} input.jobs rows from cron.job
 * @param {ReadonlyArray<{ jobname: string, status: string, start_time: Date | string | null, return_message: string | null }>} input.latestRuns one row per job, the most recent run
 * @param {ReadonlyArray<string>} [input.expected] job names to check (defaults to EXPECTED_CRON_JOBS)
 * @param {HttpResponsesInput} [input.httpResponses] net._http_response rows in the window, or why they could not be read
 * @returns {{ ok: boolean, problems: string[], jobs: CronJobReportRow[], httpResponses: HttpResponsesSummary }}
 */
export function evaluateCronHealth({ jobs, latestRuns, expected = EXPECTED_CRON_JOBS, httpResponses }) {
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

  const http = summarizeHttpResponses(httpResponses);
  const problems = [
    ...reportRows.flatMap((row) => (row.problem ? [row.problem] : [])),
    ...(http.problem ? [http.problem] : []),
  ];
  return { ok: problems.length === 0, problems, jobs: reportRows, httpResponses: http.summary };
}

/** @param {HttpResponseRow} row */
function classifyHttpFailure(row) {
  if (row.timed_out) return "timed_out";
  if (row.status_code != null && row.status_code !== 200) return `status ${row.status_code}`;
  if (row.error_msg) return "error";
  return null;
}

/**
 * One aggregate line for every failed response in the window: kinds counted
 * in order of first appearance, plus the latest failure time. Never a URL,
 * header, or body.
 *
 * @param {HttpResponsesInput | undefined} input
 * @returns {{ summary: HttpResponsesSummary, problem: string | null }}
 */
function summarizeHttpResponses(input) {
  if (!input) return { summary: HTTP_NOT_QUERIED, problem: null };
  if (!input.available) return { summary: { available: false, reason: input.reason }, problem: null };

  const failures = input.rows
    .map((row) => ({ kind: classifyHttpFailure(row), created: toIso(row.created) }))
    .filter((failure) => failure.kind !== null);
  const summary = {
    available: true,
    windowHours: input.windowHours,
    total: input.rows.length,
    failed: failures.length,
  };
  if (failures.length === 0) return { summary, problem: null };

  const countsByKind = failures.reduce(
    (counts, failure) => counts.set(failure.kind, (counts.get(failure.kind) ?? 0) + 1),
    new Map()
  );
  const kinds = [...countsByKind].map(([kind, count]) => `${kind} x${count}`).join(", ");
  const latest = failures.map((failure) => failure.created).sort().at(-1);
  const problem = `net._http_response: ${failures.length} of ${input.rows.length} responses in the last ${input.windowHours}h failed: ${kinds}; latest failure ${latest}`;
  return { summary, problem };
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

  const http = evaluation.httpResponses;
  const httpLine = http.available
    ? `net._http_response (last ${http.windowHours}h): ${http.total} responses, ${http.total - http.failed} ok, ${http.failed} failed`
    : `net._http_response: unavailable (${http.reason})`;

  const problemLines =
    evaluation.problems.length === 0
      ? []
      : [`PROBLEMS (${evaluation.problems.length}):`, ...evaluation.problems.map((problem) => `  - ${problem}`)];

  const verdict = evaluation.ok ? "VERDICT: OK" : "VERDICT: FAIL";

  return [header, ...jobLines, backgroundLine, httpLine, ...problemLines, verdict];
}
