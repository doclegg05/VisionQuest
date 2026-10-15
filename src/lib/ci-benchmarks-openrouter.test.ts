import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { DEFAULT_GEMINI_MODEL } from "./gemini";

/**
 * Issue #220: from 2026-10-07 the repo's GEMINI_API_KEY Actions secret held a
 * revoked key. The secret was not blank, so every Gemini-backed nightly suite
 * ran and failed every call: explain-faithfulness errored, sage-grounding and
 * sage-readability read pass_rate 0, and sage-latency passed on zero samples.
 * The model suites now reach production's model through OpenRouter, the same
 * route the Sage Evals workflow takes (src/lib/ci-sage-evals-openrouter.test.ts).
 *
 * A workflow has no unit under test, so this file is the acceptance test: it
 * reads .github/workflows/benchmarks.yml and the suite configs as text.
 */

/** The workflow without its comment lines, so prose about a key never counts as mapping it. */
const WORKFLOW = readFileSync(path.resolve(".github/workflows/benchmarks.yml"), "utf8")
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");
const OPENROUTER_SECRET = "OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}";

const benchmarksJob = WORKFLOW.slice(WORKFLOW.indexOf("\n  benchmarks:\n"), WORKFLOW.indexOf("\n  commit-results:\n"));
const jobHeader = benchmarksJob.slice(0, benchmarksJob.indexOf("\n    steps:\n"));
const steps = benchmarksJob.split(/\n(?= {6}- )/).filter((part) => part.startsWith("      - "));
const stepName = (step: string) => step.match(/- name: ([^\n]*)/)?.[1] ?? step.slice(0, 60);
const suiteSteps = steps.filter((step) => /npm run bench -- /.test(step));

type SuiteConfig = { suite: string; tier: string; requires?: string[] };
const SUITES: SuiteConfig[] = readdirSync(path.resolve("config/benchmarks"))
  .filter((name) => name.endsWith(".json") && name !== "result.schema.json")
  .map((name) => JSON.parse(readFileSync(path.resolve("config/benchmarks", name), "utf8")) as SuiteConfig)
  .filter((config) => typeof config.suite === "string");

function suitesRequiring(requirement: string, tiers: string[]): string[] {
  return SUITES.filter((config) => tiers.includes(config.tier) && (config.requires ?? []).includes(requirement))
    .map((config) => config.suite)
    .sort();
}

describe("Benchmarks workflow: model suites go through OpenRouter", () => {
  it("finds the two steps that run suites", () => {
    assert.deepEqual(suiteSteps.map(stepName), ["Nightly-tier benchmarks", "Watch-tier benchmarks"]);
  });

  it("gives the OpenRouter key to those two steps and to no other step or level", () => {
    for (const step of suiteSteps) {
      assert.ok(step.includes(`          ${OPENROUTER_SECRET}`), `"${stepName(step)}" must map OPENROUTER_API_KEY in its own env`);
    }
    for (const step of steps.filter((candidate) => !suiteSteps.includes(candidate))) {
      assert.doesNotMatch(step, /OPENROUTER_API_KEY/, `"${stepName(step)}" runs no model and must hold no model key`);
    }
    assert.doesNotMatch(jobHeader, /OPENROUTER_API_KEY/, "no model key at job level");
  });

  it("maps no Gemini key anywhere", () => {
    assert.doesNotMatch(WORKFLOW, /GEMINI_API_KEY/);
  });

  it("measures production's model", () => {
    const model = jobHeader.match(/^ {6}OPENROUTER_MODEL: (\S+)$/m)?.[1];
    assert.equal(model, `google/${DEFAULT_GEMINI_MODEL}`);
  });
});

describe("Benchmark suite configs: which model each scheduled suite needs", () => {
  const scheduled = ["gate", "nightly", "watch"];

  it("runs the Sage model suites through OpenRouter", () => {
    assert.deepEqual(suitesRequiring("openrouter", scheduled), [
      "explain-faithfulness",
      "sage-career",
      "sage-grounding",
      "sage-readability",
    ]);
  });

  it("leaves only sage-latency on Gemini, where it reports skipped", () => {
    // Its floor is production's direct-to-Google p95 bar (config/sage-slo.json),
    // and a round trip through OpenRouter is a different measurement. With no
    // Gemini key mapped it reports skipped until a key is restored.
    assert.deepEqual(suitesRequiring("gemini", scheduled), ["sage-latency"]);
  });
});
