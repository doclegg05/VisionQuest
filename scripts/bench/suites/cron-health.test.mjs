import { test } from "node:test";
import assert from "node:assert/strict";
import { toMetrics } from "./cron-health.mjs";

const EXPECTED = ["a", "b", "c", "d"];

function evaluation(jobs) {
  return { jobs, httpResponses: { available: false, reason: "not queried" }, problems: [], ok: true };
}

test("toMetrics: expected_jobs_healthy is the fraction with no problem", () => {
  const result = toMetrics(
    evaluation([
      { jobname: "a", present: true, active: true, problem: null },
      { jobname: "b", present: true, active: true, problem: null },
      { jobname: "c", present: true, active: true, problem: null },
      { jobname: "d", present: false, active: false, problem: "d: missing from cron.job" },
    ]),
    { countsByStatus: [{ status: "pending", count: 5 }], oldestPendingCreatedAt: null },
    EXPECTED
  );
  const healthy = result.metrics.find((m) => m.id === "expected_jobs_healthy");
  assert.equal(healthy.value, 3 / 4);
  assert.equal(healthy.n, 4);
});

test("toMetrics: all healthy is exactly 1.0 (the 7/7 floor this suite gates on in the real repo)", () => {
  const result = toMetrics(
    evaluation(EXPECTED.map((jobname) => ({ jobname, present: true, active: true, problem: null }))),
    { countsByStatus: [], oldestPendingCreatedAt: null },
    EXPECTED
  );
  assert.equal(result.metrics.find((m) => m.id === "expected_jobs_healthy").value, 1);
});

test("toMetrics: pending_background_jobs is 0, not undefined, when there is no pending row at all", () => {
  const result = toMetrics(
    evaluation(EXPECTED.map((jobname) => ({ jobname, present: true, active: true, problem: null }))),
    { countsByStatus: [{ status: "completed", count: 12 }], oldestPendingCreatedAt: null },
    EXPECTED
  );
  assert.equal(result.metrics.find((m) => m.id === "pending_background_jobs").value, 0);
});

test("toMetrics: pending_background_jobs reads the pending row's count", () => {
  const result = toMetrics(
    evaluation(EXPECTED.map((jobname) => ({ jobname, present: true, active: true, problem: null }))),
    { countsByStatus: [{ status: "pending", count: 153 }], oldestPendingCreatedAt: "2026-05-14T00:00:00.000Z" },
    EXPECTED
  );
  const pending = result.metrics.find((m) => m.id === "pending_background_jobs");
  assert.equal(pending.value, 153);
  assert.equal(pending.details.oldestPendingCreatedAt, "2026-05-14T00:00:00.000Z");
});
