import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSessions, findMissingLines } from "./split-sessions.mjs";

const fixture = [
  "# Project Memory",
  "",
  "## Project Overview",
  "- Name: Demo",
  "",
  "## Also 2026-10-16 (alpha work)",
  "- **Date**: 2026-10-16",
  "- alpha fact one",
  "",
  "## Also 2026-10-16 (beta work)",
  "- beta fact one",
  "",
  "## Previous Session",
  "- **Date**: 2026-07-31 (review)",
  "- previous fact one",
  "",
  "## Known Issues",
  "- an issue",
  "",
].join("\n");

test("distinct filenames for same-date headings", () => {
  const { handoffs } = splitSessions(fixture);
  const same = handoffs.filter((h) => h.filename.startsWith("2026-10-16-"));
  assert.equal(same.length, 2);
  assert.notEqual(same[0].filename, same[1].filename);
});

test("date falls back to the Date line", () => {
  const { handoffs } = splitSessions(fixture);
  assert.ok(handoffs.some((h) => h.filename.startsWith("2026-07-31-")));
});

test("non-session sections stay in order", () => {
  const { kept } = splitSessions(fixture);
  assert.ok(kept.indexOf("## Project Overview") < kept.indexOf("## Known Issues"));
  assert.ok(!kept.includes("## Also"));
});

test("findMissingLines is empty after split", () => {
  const { kept, handoffs } = splitSessions(fixture);
  assert.deepEqual(
    findMissingLines(fixture, [kept, ...handoffs.map((h) => h.content)]),
    [],
  );
});

test("findMissingLines reports a dropped line", () => {
  const { kept, handoffs } = splitSessions(fixture);
  const outputs = [kept, ...handoffs.slice(1).map((h) => h.content)];
  assert.ok(findMissingLines(fixture, outputs).includes("- alpha fact one"));
});
