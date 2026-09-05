import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPECTED_CRON_JOBS,
  evaluateCronHealth,
  formatCronHealthReport,
} from "../../scripts/lib/cron-health.mjs";

// The eight names the scheduled layer must carry: the four baseline jobs the
// 2026-09 repair re-registers, the three Sage jobs that already existed, and
// connect-nudges (2026-09-05, migration 20260905140000_add_connect_nudges_cron).
const ALL_EIGHT = [
  "appointment-reminders",
  "job-processor",
  "daily-coaching",
  "cron-health-monitor",
  "sage-daily-briefing",
  "sage-memory-consolidate",
  "sage-wager-resolve",
  "connect-nudges",
];

function healthyJobs(names = ALL_EIGHT) {
  return names.map((jobname) => ({ jobname, schedule: "0 * * * *", active: true }));
}

function healthyRuns(names = ALL_EIGHT) {
  return names.map((jobname) => ({
    jobname,
    status: "succeeded",
    start_time: new Date("2026-09-02T10:00:00Z"),
    return_message: "1 row",
  }));
}

describe("EXPECTED_CRON_JOBS (scripts/lib/cron-health.mjs)", () => {
  it("lists exactly the eight scheduled jobs", () => {
    assert.deepEqual([...EXPECTED_CRON_JOBS].sort(), [...ALL_EIGHT].sort());
  });
});

describe("evaluateCronHealth", () => {
  it("is ok when every expected job is present, active, and last succeeded", () => {
    const result = evaluateCronHealth({ jobs: healthyJobs(), latestRuns: healthyRuns() });
    assert.equal(result.ok, true);
    assert.deepEqual(result.problems, []);
    assert.equal(result.jobs.length, 8);
  });

  it("fails when connect-nudges is missing from cron.job (the eighth job, added 2026-09-05)", () => {
    const names = ALL_EIGHT.filter((n) => n !== "connect-nudges");
    const result = evaluateCronHealth({ jobs: healthyJobs(names), latestRuns: healthyRuns(names) });
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, ["connect-nudges: missing from cron.job"]);
    const row = result.jobs.find((j) => j.jobname === "connect-nudges");
    assert.equal(row?.present, false);
  });

  it("fails when connect-nudges is registered but its latest run failed", () => {
    const runs = healthyRuns().map((r) =>
      r.jobname === "connect-nudges"
        ? {
            ...r,
            status: "failed",
            start_time: new Date("2026-09-05T15:30:00Z"),
            return_message: "ERROR: relation \"vault.decrypted_secrets\" does not exist",
          }
        : r
    );
    const result = evaluateCronHealth({ jobs: healthyJobs(), latestRuns: runs });
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, [
      'connect-nudges: latest run failed at 2026-09-05T15:30:00.000Z: ERROR: relation "vault.decrypted_secrets" does not exist',
    ]);
  });

  it("fails when an expected job is missing from cron.job", () => {
    const names = ALL_EIGHT.filter((n) => n !== "job-processor");
    const result = evaluateCronHealth({ jobs: healthyJobs(names), latestRuns: healthyRuns(names) });
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, ["job-processor: missing from cron.job"]);
    const row = result.jobs.find((j) => j.jobname === "job-processor");
    assert.equal(row?.present, false);
  });

  it("reports every missing baseline job when none were ever registered (the F1 state)", () => {
    // connect-nudges did not exist at the time of the 2026-09-01 F1 incident
    // this replays — included here (as present) so this scenario keeps
    // testing exactly "the four baseline jobs are missing", not incidentally
    // also flagging a job the F1 state predates.
    const sageAndConnect = ["sage-daily-briefing", "sage-memory-consolidate", "sage-wager-resolve", "connect-nudges"];
    const result = evaluateCronHealth({ jobs: healthyJobs(sageAndConnect), latestRuns: healthyRuns(sageAndConnect) });
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, [
      "appointment-reminders: missing from cron.job",
      "job-processor: missing from cron.job",
      "daily-coaching: missing from cron.job",
      "cron-health-monitor: missing from cron.job",
    ]);
  });

  it("fails when a job is registered but inactive", () => {
    const jobs = healthyJobs().map((j) => (j.jobname === "daily-coaching" ? { ...j, active: false } : j));
    const result = evaluateCronHealth({ jobs, latestRuns: healthyRuns() });
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, ["daily-coaching: registered but inactive"]);
  });

  it("fails when a job has never run", () => {
    const runs = healthyRuns().filter((r) => r.jobname !== "sage-wager-resolve");
    const result = evaluateCronHealth({ jobs: healthyJobs(), latestRuns: runs });
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, ["sage-wager-resolve: never run"]);
    const row = result.jobs.find((j) => j.jobname === "sage-wager-resolve");
    assert.equal(row?.lastRun, null);
  });

  it("fails when the latest run failed, quoting status, start time, and return_message", () => {
    const runs = healthyRuns().map((r) =>
      r.jobname === "sage-daily-briefing"
        ? {
            ...r,
            status: "failed",
            start_time: new Date("2026-09-01T11:00:00Z"),
            return_message: 'ERROR: unrecognized configuration parameter "app.base_url"',
          }
        : r
    );
    const result = evaluateCronHealth({ jobs: healthyJobs(), latestRuns: runs });
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, [
      'sage-daily-briefing: latest run failed at 2026-09-01T11:00:00.000Z: ERROR: unrecognized configuration parameter "app.base_url"',
    ]);
  });

  it("treats an in-progress latest run (starting/running) as not failed", () => {
    const runs = healthyRuns().map((r) =>
      r.jobname === "job-processor" ? { ...r, status: "running", return_message: null } : r
    );
    const result = evaluateCronHealth({ jobs: healthyJobs(), latestRuns: runs });
    assert.equal(result.ok, true);
  });

  it("accepts ISO strings for start_time (driver-dependent row shape)", () => {
    const runs = healthyRuns().map((r) =>
      r.jobname === "job-processor"
        ? { ...r, status: "failed", start_time: "2026-09-02T09:50:00.000Z", return_message: null }
        : r
    );
    const result = evaluateCronHealth({ jobs: healthyJobs(), latestRuns: runs });
    assert.deepEqual(result.problems, ["job-processor: latest run failed at 2026-09-02T09:50:00.000Z: (no return_message)"]);
  });

  it("keeps problems in EXPECTED_CRON_JOBS order and one line per job", () => {
    const jobs = healthyJobs().filter((j) => j.jobname !== "appointment-reminders");
    const runs = healthyRuns().filter((r) => r.jobname !== "appointment-reminders" && r.jobname !== "sage-wager-resolve");
    const result = evaluateCronHealth({ jobs, latestRuns: runs });
    assert.deepEqual(result.problems, [
      "appointment-reminders: missing from cron.job",
      "sage-wager-resolve: never run",
    ]);
  });

  it("does not mutate its inputs", () => {
    const jobs = healthyJobs();
    const runs = healthyRuns();
    const jobsSnapshot = JSON.stringify(jobs);
    const runsSnapshot = JSON.stringify(runs);
    evaluateCronHealth({ jobs, latestRuns: runs });
    assert.equal(JSON.stringify(jobs), jobsSnapshot);
    assert.equal(JSON.stringify(runs), runsSnapshot);
  });
});

describe("formatCronHealthReport", () => {
  it("renders aggregate lines only: job rows, BackgroundJob counts, oldest pending, verdict", () => {
    const evaluation = evaluateCronHealth({ jobs: healthyJobs(), latestRuns: healthyRuns() });
    const lines = formatCronHealthReport({
      evaluation,
      backgroundJobs: {
        countsByStatus: [
          { status: "pending", count: 153 },
          { status: "completed", count: 4210 },
        ],
        oldestPendingCreatedAt: new Date("2026-03-27T14:02:00Z"),
      },
      connection: { host: "db.example.supabase.co", database: "postgres", role: "postgres" },
      generatedAt: "2026-09-02T12:00:00.000Z",
    });
    const text = lines.join("\n");
    assert.match(text, /cron-health-check 2026-09-02T12:00:00.000Z/);
    assert.match(text, /db\.example\.supabase\.co\/postgres role=postgres/);
    assert.match(text, /appointment-reminders\s+present active schedule="0 \* \* \* \*" last=succeeded 2026-09-02T10:00:00.000Z/);
    assert.match(text, /BackgroundJob: pending=153 completed=4210/);
    assert.match(text, /oldest pending createdAt=2026-03-27T14:02:00.000Z/);
    assert.match(text, /VERDICT: OK/);
    assert.doesNotMatch(text, /payload/i);
  });

  it("lists each problem under PROBLEMS and ends with VERDICT: FAIL", () => {
    const evaluation = evaluateCronHealth({ jobs: [], latestRuns: [] });
    const lines = formatCronHealthReport({
      evaluation,
      backgroundJobs: { countsByStatus: [], oldestPendingCreatedAt: null },
      connection: { host: "localhost", database: "x", role: "postgres" },
      generatedAt: "2026-09-02T12:00:00.000Z",
    });
    const text = lines.join("\n");
    assert.match(text, /PROBLEMS \(8\):/);
    assert.match(text, /- job-processor: missing from cron.job/);
    assert.match(text, /BackgroundJob: \(no rows\)/);
    assert.match(text, /oldest pending createdAt=none/);
    assert.match(text, /VERDICT: FAIL/);
  });
});

// net.http_post/http_get are asynchronous: a cron run is recorded `succeeded`
// whether the app answered 200, 401, 404, or 500. The HTTP outcome lives only
// in net._http_response, for pg_net's ttl (default 6 hours).
describe("evaluateCronHealth: net._http_response", () => {
  const ok = (id: number, created: string) => ({ id, status_code: 200, error_msg: null, timed_out: false, created });

  it("fails on any non-200, errored, or timed-out response, as one aggregate line", () => {
    const result = evaluateCronHealth({
      jobs: healthyJobs(),
      latestRuns: healthyRuns(),
      httpResponses: {
        available: true,
        windowHours: 6,
        rows: [
          ok(1, "2026-09-02T06:00:00Z"),
          { id: 2, status_code: 401, error_msg: null, timed_out: false, created: "2026-09-02T07:00:00Z" },
          { id: 3, status_code: 401, error_msg: null, timed_out: false, created: "2026-09-02T08:00:00Z" },
          { id: 4, status_code: null, error_msg: null, timed_out: true, created: "2026-09-02T09:00:00Z" },
          { id: 5, status_code: null, error_msg: "Couldn't resolve host name", timed_out: false, created: "2026-09-02T10:00:00Z" },
          ok(6, "2026-09-02T11:00:00Z"),
        ],
      },
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, [
      "net._http_response: 4 of 6 responses in the last 6h failed: status 401 x2, timed_out x1, error x1; latest failure 2026-09-02T10:00:00.000Z",
    ]);
    assert.deepEqual(result.httpResponses, { available: true, windowHours: 6, total: 6, failed: 4 });
  });

  it("is ok when every response in the window is 200", () => {
    const result = evaluateCronHealth({
      jobs: healthyJobs(),
      latestRuns: healthyRuns(),
      httpResponses: { available: true, windowHours: 6, rows: [ok(1, "2026-09-02T10:00:00Z"), ok(2, "2026-09-02T10:10:00Z")] },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.httpResponses, { available: true, windowHours: 6, total: 2, failed: 0 });
  });

  it("does not fail when net._http_response is unavailable, but records the reason", () => {
    const result = evaluateCronHealth({
      jobs: healthyJobs(),
      latestRuns: healthyRuns(),
      httpResponses: { available: false, reason: 'relation "net._http_response" does not exist' },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.httpResponses, { available: false, reason: 'relation "net._http_response" does not exist' });
  });

  it("treats an omitted httpResponses argument as unavailable", () => {
    const result = evaluateCronHealth({ jobs: healthyJobs(), latestRuns: healthyRuns() });
    assert.equal(result.ok, true);
    assert.equal(result.httpResponses.available, false);
  });

  it("still reports cron problems alongside an HTTP problem, cron first", () => {
    const result = evaluateCronHealth({
      jobs: healthyJobs().filter((j) => j.jobname !== "job-processor"),
      latestRuns: healthyRuns(),
      httpResponses: {
        available: true,
        windowHours: 6,
        rows: [{ id: 1, status_code: 500, error_msg: null, timed_out: false, created: "2026-09-02T10:00:00Z" }],
      },
    });
    assert.deepEqual(result.problems, [
      "job-processor: missing from cron.job",
      "net._http_response: 1 of 1 responses in the last 6h failed: status 500 x1; latest failure 2026-09-02T10:00:00.000Z",
    ]);
  });
});

describe("formatCronHealthReport: net._http_response line", () => {
  const base = {
    backgroundJobs: { countsByStatus: [], oldestPendingCreatedAt: null },
    connection: { host: "localhost", database: "x", role: "postgres" },
    generatedAt: "2026-09-02T12:00:00.000Z",
  };

  it("prints totals when available", () => {
    const evaluation = evaluateCronHealth({
      jobs: healthyJobs(),
      latestRuns: healthyRuns(),
      httpResponses: {
        available: true,
        windowHours: 6,
        rows: [
          { id: 1, status_code: 200, error_msg: null, timed_out: false, created: "2026-09-02T10:00:00Z" },
          { id: 2, status_code: 401, error_msg: null, timed_out: false, created: "2026-09-02T11:00:00Z" },
        ],
      },
    });
    const text = formatCronHealthReport({ evaluation, ...base }).join("\n");
    assert.match(text, /net\._http_response \(last 6h\): 2 responses, 1 ok, 1 failed/);
    assert.match(text, /VERDICT: FAIL/);
  });

  it("says unavailable, with the reason, when it could not be read", () => {
    const evaluation = evaluateCronHealth({
      jobs: healthyJobs(),
      latestRuns: healthyRuns(),
      httpResponses: { available: false, reason: "permission denied for schema net" },
    });
    const text = formatCronHealthReport({ evaluation, ...base }).join("\n");
    assert.match(text, /net\._http_response: unavailable \(permission denied for schema net\)/);
    assert.match(text, /VERDICT: OK/);
  });
});
