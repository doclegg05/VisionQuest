import assert from "node:assert/strict";
import test from "node:test";
import { formatDueDate } from "./format-due-date";

test("teacher-timed due dates show the local day and time", () => {
  const out = formatDueDate("2026-10-28T01:00:00.000Z", "America/New_York");
  assert.ok(out.includes("Oct 27, 2026"), out);
  assert.ok(out.includes("9:00"), out);
});

test("date-only values keep their calendar day in any zone", () => {
  assert.equal(formatDueDate("2026-10-27T12:00:00.000Z", "America/New_York"), "Oct 27, 2026");
  assert.equal(formatDueDate("2026-10-27T12:00:00.000Z", "Pacific/Kiritimati"), "Oct 27, 2026");
});

test("null shows No due date", () => {
  assert.equal(formatDueDate(null), "No due date");
});
