import assert from "node:assert/strict";
import { test } from "node:test";
import { taskDetails } from "./task-schemas";
import { toIsoDueAt } from "./due-date";

test("rejects the raw datetime-local value today", () => {
  assert.equal(taskDetails.safeParse({ title: "x", dueAt: "2026-10-27T09:30" }).success, false);
});

test("zones a datetime-local value", () => {
  const iso = toIsoDueAt("2026-10-27T09:30");
  assert.ok(iso.endsWith("Z"));
  assert.equal(new Date(iso).getTime(), new Date("2026-10-27T09:30").getTime());
  assert.equal(taskDetails.safeParse({ title: "x", dueAt: iso }).success, true);
});

test("keeps the instant across DST", () => {
  const value = "2026-11-01T01:30";
  assert.equal(new Date(toIsoDueAt(value)).getTime(), new Date(value).getTime());
});

test("passes empty and date-only through", () => {
  assert.equal(toIsoDueAt(""), "");
  assert.equal(toIsoDueAt("2026-10-27"), "2026-10-27");
});
