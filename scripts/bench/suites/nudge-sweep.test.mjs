// =============================================================================
// The nudge-sweep scorer's pure parts.
//
// The suite itself needs a database, so these cover the two pieces that decide
// what its numbers MEAN and can be checked without one: reading the runner's
// own deadline budget out of its source (never a copy), and turning a harness
// report into metric values — including the report shape that was the real
// outage this suite found on its first run.
// =============================================================================
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readDeadlineBudgetMs, scoreReport } from "./nudge-sweep.mjs";

const HEALTHY = {
  ran: true,
  sweepDurationMs: 400,
  sendsPerRun: 11,
  allSkipped: [null, null, "already running"],
  sendErrors: 0,
  concurrent: { ran: 1 },
  capStress: { attempts: 10, accepted: 2, capConsumingRows: 2, dailyCap: 2 },
  perStudentDailyMax: 2,
  duplicateOpenQuestions: 0,
};

describe("readDeadlineBudgetMs", () => {
  it("subtracts the send margin from the lock timeout", () => {
    const source = "const RUN_LOCK_TIMEOUT_MS = 240_000;\nconst SEND_DEADLINE_MARGIN_MS = 15_000;";
    assert.equal(readDeadlineBudgetMs(source), 225_000);
  });

  it("throws rather than inventing a budget when a constant moves", () => {
    assert.throws(
      () => readDeadlineBudgetMs("const SEND_DEADLINE_MARGIN_MS = 15_000;"),
      /RUN_LOCK_TIMEOUT_MS/,
    );
  });

  it("reads the real schedule.ts, so a rename here fails loudly", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../../src/lib/nudges/schedule.ts", import.meta.url),
      "utf8",
    );
    const budget = readDeadlineBudgetMs(source);
    assert.equal(budget > 0, true);
  });
});

describe("scoreReport", () => {
  it("reports zeroes for a healthy run", () => {
    const values = scoreReport(HEALTHY, 225_000);
    assert.deepEqual(values, {
      sweep_blocked: 0,
      send_errors: 0,
      daily_cap_exceeded: 0,
      duplicate_open_questions: 0,
      concurrent_run_not_skipped: 0,
      deadline_overrun_ms: 0,
      sweep_duration_ms: 400,
      sends_per_run: 11,
    });
  });

  it("counts a blocked sweep, and does not count the lock doing its job", () => {
    // The real outage: every sweep refused because the advisory-lock overload
    // did not exist. Three runs, three blocks.
    const blocked = scoreReport(
      { ...HEALTHY, allSkipped: Array(3).fill("run lock unavailable"), concurrent: { ran: 0 } },
      225_000,
    );
    assert.equal(blocked.sweep_blocked, 3);
    // "already running" is the lock working, not a blocked sweep.
    assert.equal(scoreReport(HEALTHY, 225_000).sweep_blocked, 0);
    assert.equal(
      scoreReport({ ...HEALTHY, allSkipped: [null, "admin client not privileged"] }, 225_000)
        .sweep_blocked,
      1,
    );
  });

  it("counts sends the policy refused with send_error", () => {
    assert.equal(scoreReport({ ...HEALTHY, sendErrors: 7 }, 225_000).send_errors, 7);
  });

  it("counts cap overshoot from the stressed recipient and from the cohort", () => {
    const raced = scoreReport(
      { ...HEALTHY, capStress: { ...HEALTHY.capStress, capConsumingRows: 8 }, perStudentDailyMax: 8 },
      225_000,
    );
    // Six over on the stressed recipient, six over on the cohort maximum —
    // which is the same recipient here, and deliberately counted from both
    // read paths so a cap that holds in one and not the other is still seen.
    assert.equal(raced.daily_cap_exceeded, 12);
  });

  it("counts a second concurrent sweep that was not skipped", () => {
    assert.equal(scoreReport({ ...HEALTHY, concurrent: { ran: 2 } }, 225_000).concurrent_run_not_skipped, 1);
    assert.equal(scoreReport({ ...HEALTHY, concurrent: { ran: 0 } }, 225_000).concurrent_run_not_skipped, 0);
  });

  it("counts only the time past the budget, never a credit for finishing early", () => {
    assert.equal(scoreReport({ ...HEALTHY, sweepDurationMs: 230_000 }, 225_000).deadline_overrun_ms, 5_000);
    assert.equal(scoreReport({ ...HEALTHY, sweepDurationMs: 10 }, 225_000).deadline_overrun_ms, 0);
  });
});
