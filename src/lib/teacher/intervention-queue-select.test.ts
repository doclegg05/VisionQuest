import assert from "node:assert/strict";
import test from "node:test";
import { interventionQueueStudentSelect } from "./intervention-queue-select";

test("the queue never loads the student-facing weekly-jobs nudge", () => {
  const select = interventionQueueStudentSelect(new Date("2026-10-15T00:00:00.000Z"));
  assert.deepEqual(select.alerts.where, {
    status: "open",
    type: { not: "connect_weekly_jobs_ready" },
  });
});
