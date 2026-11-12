import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/sage-evals.yml", import.meta.url), "utf8");

/** Every quoted entry in the `paths:` lists of the workflow, in file order. */
function pathFilterEntries(): string[] {
  const entries: string[] = [];
  let inPaths = false;
  for (const line of workflow.split("\n")) {
    if (/^\s*paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    const item = line.match(/^\s*-\s*"([^"]+)"\s*$/);
    if (inPaths && item) {
      entries.push(item[1]);
      continue;
    }
    inPaths = false;
  }
  return entries;
}

// Sage's behaviour depends on the provider code, the chat code and the chat
// route as well as on src/lib/sage. A change to any of them must run the evals.
const REQUIRED_PATHS = [
  "src/lib/sage/**",
  "src/lib/ai/**",
  "src/lib/chat/**",
  "src/app/api/chat/**",
  ".github/workflows/sage-evals.yml",
];

test("the Sage evals run for every change that can change Sage", () => {
  const entries = pathFilterEntries();
  for (const required of REQUIRED_PATHS) {
    assert.ok(entries.includes(required), `path filter must list ${required}`);
  }
});

test("the workflow has exactly one path filter, on pull requests", () => {
  assert.equal(workflow.match(/^\s*paths:\s*$/gm)?.length, 1);
  const trigger = workflow.match(/^on:\n([\s\S]*?)\n\npermissions:/m);
  assert.ok(trigger, "on: block must precede permissions:");
  assert.match(trigger[1], /pull_request:\n\s+branches: \[main\]\n\s+paths:/);
  assert.doesNotMatch(trigger[1], /^\s{2}push:/m);
});
