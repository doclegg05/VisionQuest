import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMemoryFile } from "./validate-memory-file.mjs";

const HEADINGS = [
  "## Project Overview",
  "## Current Status",
  "## Last Session",
  "## Open Items",
  "## History and Decisions",
  "## Architecture Notes",
  "## Known Issues",
];

function build(headings = HEADINGS, extra = []) {
  const lines = ["# Project Memory", ""];
  for (const h of headings) lines.push(h, "- a fact", "");
  return [...lines, ...extra].join("\n");
}

test("valid fixture has no errors", () => {
  assert.deepEqual(checkMemoryFile(build()), []);
});

test("over 300 lines fails", () => {
  const filler = Array.from({ length: 300 }, (_, i) => `filler ${i}`);
  const errors = checkMemoryFile(build(HEADINGS, filler));
  assert.ok(errors.some((e) => e.includes("300")));
});

test("prior session heading fails", () => {
  const errors = checkMemoryFile(
    build(HEADINGS, ["## Prior Session (2026-01-01)", "- x"]),
  );
  assert.ok(errors.some((e) => e.includes("session heading")));
});

test("closed item fails", () => {
  const errors = checkMemoryFile(build(HEADINGS, ["- [x] done"]));
  assert.ok(errors.some((e) => e.includes("closed item")));
});

test("struck text fails", () => {
  const errors = checkMemoryFile(build(HEADINGS, ["- ~~old~~ note"]));
  assert.ok(errors.some((e) => e.includes("closed item")));
});

test("missing heading fails", () => {
  const errors = checkMemoryFile(
    build(HEADINGS.filter((h) => h !== "## Known Issues")),
  );
  assert.ok(errors.some((e) => e.includes("Known Issues")));
});

test("headings out of order fail", () => {
  const swapped = [...HEADINGS];
  [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
  const errors = checkMemoryFile(build(swapped));
  assert.ok(errors.some((e) => e.includes("order")));
});

test("long Current Status fails", () => {
  const status = Array.from({ length: 21 }, (_, i) => `- line ${i}`);
  const text = build().replace(
    "## Current Status\n",
    `## Current Status\n${status.join("\n")}\n`,
  );
  const errors = checkMemoryFile(text);
  assert.ok(errors.some((e) => e.includes("Current Status")));
});

test("long Last Session fails", () => {
  const body = Array.from({ length: 5 }, (_, i) => `- line ${i}`);
  const text = build().replace(
    "## Last Session\n",
    `## Last Session\n${body.join("\n")}\n`,
  );
  const errors = checkMemoryFile(text);
  assert.ok(errors.some((e) => e.includes("Last Session")));
});
