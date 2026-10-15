import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 2026-10-15: the chat-harness suites (sage-grounding, sage-readability,
 * sage-career) call production's model through OpenRouter. The key is mapped
 * only on the two steps that run `npm run bench`, never at job level, so the
 * setup steps (`npm ci` and any dependency lifecycle script it runs, the
 * migrations, the seeds) never hold it. Same rule as sage-evals.yml. The
 * workflow has no unit under test, so this reads its YAML as text.
 */

const WORKFLOW = readFileSync(
  path.join(import.meta.dirname, "..", "..", "..", ".github/workflows/benchmarks.yml"),
  "utf8",
);
const KEY_MAPPING = "OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}";

/** The `benchmarks` job, up to the next top-level job. */
function benchmarksJob() {
  const match = WORKFLOW.match(/\n  benchmarks:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n)/);
  assert.ok(match, "expected a `benchmarks` job in benchmarks.yml");
  return match[1];
}

/** The job-level `env:` block: everything between `    env:` and `    steps:`. */
function jobEnv() {
  const match = benchmarksJob().match(/\n    env:\n([\s\S]*?)\n    steps:\n/);
  assert.ok(match, "expected a job-level env block in the benchmarks job");
  return match[1];
}

/** Each step of the benchmarks job, as text. */
function steps() {
  const body = benchmarksJob().split("\n    steps:\n")[1];
  return body.split(/\n(?=      - )/).filter((step) => step.trimStart().startsWith("- "));
}

function stepNamed(name) {
  const step = steps().find((text) => text.includes(`- name: ${name}\n`));
  assert.ok(step, `expected a step named "${name}"`);
  return step;
}

test("the benchmarks job's env does not hold the OpenRouter key", () => {
  assert.doesNotMatch(jobEnv(), /OPENROUTER_API_KEY/);
});

for (const name of ["Nightly-tier benchmarks", "Watch-tier benchmarks"]) {
  test(`"${name}" runs the bench and maps the OpenRouter key on its own env`, () => {
    const step = stepNamed(name);
    assert.match(step, /run: npm run bench -- --tier=/);
    assert.match(step, /\n        env:\n/);
    assert.ok(step.includes(KEY_MAPPING), step);
  });
}

test("no other step in the workflow maps the OpenRouter key", () => {
  const mapped = steps().filter((step) => step.includes("OPENROUTER_API_KEY"));
  assert.deepEqual(
    mapped.map((step) => step.match(/- name: ([^\n]+)/)?.[1]),
    ["Nightly-tier benchmarks", "Watch-tier benchmarks"],
  );
  assert.equal(WORKFLOW.split("secrets.OPENROUTER_API_KEY").length - 1, 2);
});
