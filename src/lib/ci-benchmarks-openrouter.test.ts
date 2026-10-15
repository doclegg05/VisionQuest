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
const modelSteps = suiteSteps.filter((step) => step.includes(OPENROUTER_SECRET));
const findStep = (name: string) => steps.find((step) => stepName(step) === name) ?? "";

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
  it("finds the three steps that run suites, two of them with the OpenRouter key", () => {
    assert.deepEqual(suiteSteps.map(stepName), [
      "Nightly-tier benchmarks",
      "Nightly-tier model benchmarks",
      "Watch-tier benchmarks",
    ]);
    assert.deepEqual(modelSteps.map(stepName), ["Nightly-tier model benchmarks", "Watch-tier benchmarks"]);
  });

  it("maps the OpenRouter key on those two steps and nowhere else in the file", () => {
    for (const step of modelSteps) {
      assert.ok(step.includes(`          ${OPENROUTER_SECRET}`), `"${stepName(step)}" must map OPENROUTER_API_KEY in its own env`);
    }
    assert.equal(WORKFLOW.split(OPENROUTER_SECRET).length - 1, modelSteps.length, "one mapping per model step");
    // Each mapping names the key twice (variable and secret); any other mention is a mapping elsewhere.
    assert.equal(WORKFLOW.split("OPENROUTER_API_KEY").length - 1, 2 * modelSteps.length, "no mapping outside the model steps");
  });

  it("keeps the production read-only URL out of every process that holds the OpenRouter key", () => {
    // scripts/lib/sage-eval-provider.mjs refuses --provider=openrouter while any
    // non-local database URL, BENCH_PROD_READONLY_URL included, is in the
    // environment: OpenRouter gets synthetic data only.
    assert.doesNotMatch(jobHeader, /BENCH_PROD_READONLY_URL/, "not at job level");
    const withProdUrl = steps.filter((step) => /BENCH_PROD_READONLY_URL/.test(step)).map(stepName);
    assert.deepEqual(withProdUrl, ["Nightly-tier benchmarks"]);
  });

  it("runs every nightly OpenRouter suite in the model step, after the tier step", () => {
    // The tier step has no OpenRouter key, so it writes `skipped` for these
    // suites; the model step must run after it to write their real results.
    const step = findStep("Nightly-tier model benchmarks");
    const listed = (step.match(/--suite=([a-z0-9,-]+)/)?.[1] ?? "").split(",").filter(Boolean).sort();
    assert.deepEqual(listed, suitesRequiring("openrouter", ["nightly"]));
    assert.match(step, /--compare/);
    assert.ok(steps.indexOf(step) > steps.indexOf(findStep("Nightly-tier benchmarks")));
    assert.match(step, /^ {8}id: nightly_models$/m);
  });

  it("files the regression issue and fails the run when either nightly step fails", () => {
    for (const name of ["Open or update the regression issue", "Fail the run when a nightly benchmark regressed"]) {
      const condition = findStep(name).match(/^ {8}if: (.+)$/m)?.[1] ?? "";
      assert.match(condition, /steps\.nightly\.outcome == 'failure'/, name);
      assert.match(condition, /steps\.nightly_models\.outcome == 'failure'/, name);
    }
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
