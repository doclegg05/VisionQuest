import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPECTED_CRON_JOBS,
  evaluateCronHealth,
  formatCronHealthReport,
} from "../../scripts/lib/cron-health.mjs";

// The seven names the scheduled layer must carry: the four baseline jobs the
// 2026-09 repair re-registers plus the three Sage jobs that already existed.
const ALL_SEVEN = [
  "appointment-reminders",
  "job-processor",
  "daily-coaching",
  "cron-health-monitor",
  "sage-daily-briefing",
  "sage-memory-consolidate",
  "sage-wager-resolve",
];

function healthyJobs(names = ALL_SEVEN) {
  return names.map((jobname) => ({ jobname, schedule: "0 * * * *", active: true }));
}

function healthyRuns(names = ALL_SEVEN) {
  return names.map((jobname) => ({
    jobname,
    status: "succeeded",
    start_time: new Date("2026-09-02T10:00:00Z"),
    return_message: "1 row",
  }));
}

describe("EXPECTED_CRON_JOBS (scripts/lib/cron-health.mjs)", () => {
  it("lists exactly the seven scheduled jobs", () => {
    assert.deepEqual([...EXPECTED_CRON_JOBS].sort(), [...ALL_SEVEN].sort());
  });
});

describe("evaluateCronHealth", () => {
  it("is ok when every expected job is present, active, and last succeeded", () => {
    const result = evaluateCronHealth({ jobs: healthyJobs(), latestRuns: healthyRuns() });
    assert.equal(result.ok, true);
    assert.deepEqual(result.problems, []);
    assert.equal(result.jobs.length, 7);
  });

  it("fails when an expected job is missing from cron.job", () => {
    const names = ALL_SEVEN.filter((n) => n !== "job-processor");
    const result = evaluateCronHealth({ jobs: healthyJobs(names), latestRuns: healthyRuns(names) });
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, ["job-processor: missing from cron.job"]);
    const row = result.jobs.find((j) => j.jobname === "job-processor");
    assert.equal(row?.present, false);
  });

  it("reports every missing baseline job when none were ever registered (the F1 state)", () => {
    const sageOnly = ["sage-daily-briefing", "sage-memory-consolidate", "sage-wager-resolve"];
    const result = evaluateCronHealth({ jobs: healthyJobs(sageOnly), latestRuns: healthyRuns(sageOnly) });
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
    assert.match(text, /PROBLEMS \(7\):/);
    assert.match(text, /- job-processor: missing from cron.job/);
    assert.match(text, /BackgroundJob: \(no rows\)/);
    assert.match(text, /oldest pending createdAt=none/);
    assert.match(text, /VERDICT: FAIL/);
  });
});
