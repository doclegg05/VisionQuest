import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  EMBEDDING_PREFLIGHT_COMMAND,
  outcomeForExit,
  parseStepArgs,
  runStep,
  skipReason,
} from "../../../scripts/lib/sage-eval-ci-step.mjs";

/**
 * The Sage Evals workflow runs every model-backed step through
 * scripts/lib/sage-eval-ci-step.mjs, so the rule "a skipped or unrunnable
 * eval never reads as a pass" lives in one tested place. Exit codes come from
 * the eval scripts: 3 = credits or key limit ran out, 4 = key, model or
 * provider unavailable.
 *
 * The classifiers behind those exit codes live in sage-eval-provider.mjs,
 * which src/ may not import (the OpenRouter import guard), so their tests are
 * in scripts/lib/sage-eval-provider.test.mjs. The workflow runs that file.
 */

type Env = Record<string, string | undefined>;

const READY_ENV: Env = { OPENROUTER_API_KEY: "sk-or-test" };
const REQUIRED: Env = { SAGE_EVAL_REQUIRED: "true" };

const GATING = parseStepArgs(["--label=Red-team eval", "--", "npm", "run", "sage:redteam:eval"]);
const INFORMATIONAL = parseStepArgs(["--label=Quality eval", "--informational", "--", "npm", "run", "sage:quality:eval"]);
const EMBEDDING = parseStepArgs(["--label=Memory eval", "--needs-gemini-embeddings", "--", "npm", "run", "sage:memory:eval"]);
const EMBEDDING_ENV: Env = { ...READY_ENV, GEMINI_API_KEY: "AIza-test" };

describe("parseStepArgs", () => {
  it("reads the label, flags and the command after --", () => {
    const step = parseStepArgs([
      "--label=Tool-selection eval",
      "--needs-gemini-embeddings",
      "--",
      "npm",
      "run",
      "sage:agent:eval",
      "--",
      "--min-accuracy=75",
    ]);
    assert.deepEqual(step, {
      label: "Tool-selection eval",
      informational: false,
      needsEmbeddings: true,
      command: ["npm", "run", "sage:agent:eval", "--", "--min-accuracy=75"],
    });
  });

  it("refuses a missing label, an empty command and an unknown flag", () => {
    assert.throws(() => parseStepArgs(["--", "npm", "test"]), /--label/);
    assert.throws(() => parseStepArgs(["--label=X", "--"]), /command/);
    assert.throws(() => parseStepArgs(["--label=X", "npm", "test"]), /--/);
    assert.throws(() => parseStepArgs(["--label=X", "--informatonal", "--", "npm", "test"]), /--informatonal/);
  });
});

describe("skipReason: a missing secret never reads as a pass", () => {
  it("lets a step with its key run, with no opt-in variable", () => {
    assert.equal(skipReason(GATING, READY_ENV), null);
    assert.equal(skipReason(GATING, { ...READY_ENV, SAGE_EVAL_BUDGET_OK: undefined, GEMINI_EVAL_BUDGET_OK: "0" }), null);
  });

  it("on a fork PR (no SAGE_EVAL_REQUIRED), skips with a notice and exit 0", () => {
    const skip = skipReason(GATING, {});
    assert.equal(skip?.exitCode, 0);
    assert.match(skip?.annotation ?? "", /^::notice::OPENROUTER_API_KEY secret not set/);
    assert.equal(skip?.summary, "- **Red-team eval**: NOT RUN — OPENROUTER_API_KEY secret not set");
  });

  it("on this repository, fails the step (exit 4) because the secret should be there", () => {
    const skip = skipReason(GATING, REQUIRED);
    assert.equal(skip?.exitCode, 4);
    assert.match(skip?.annotation ?? "", /^::error::OPENROUTER_API_KEY secret not set/);
    assert.match(skip?.summary ?? "", /NOT RUN — OPENROUTER_API_KEY secret not set$/);
    assert.equal(skipReason(GATING, { ...REQUIRED, SAGE_EVAL_REQUIRED: "false" })?.exitCode, 0);
  });

  it("lets SAGE_EVAL_SOFT_FAIL=1 pass a required step whose secret is missing", () => {
    assert.equal(skipReason(GATING, { ...REQUIRED, SAGE_EVAL_SOFT_FAIL: "1" })?.exitCode, 0);
  });

  it("treats a whitespace-only secret as absent", () => {
    assert.match(skipReason(GATING, { ...READY_ENV, OPENROUTER_API_KEY: "  " })?.summary ?? "", /NOT RUN/);
  });

  it("needs GEMINI_API_KEY for an embedding step, and only for that step", () => {
    assert.match(skipReason(EMBEDDING, READY_ENV)?.summary ?? "", /NOT RUN — GEMINI_API_KEY secret not set \(needed for embeddings\)$/);
    assert.equal(skipReason(EMBEDDING, { ...READY_ENV, ...REQUIRED })?.exitCode, 4);
    assert.equal(skipReason(EMBEDDING, EMBEDDING_ENV), null);
    assert.equal(skipReason(GATING, READY_ENV), null);
  });
});

describe("outcomeForExit: exit codes map to PASSED, FAILED or NOT RUN", () => {
  it("0 is a pass for a gating step and a report for an informational one", () => {
    assert.deepEqual(outcomeForExit(GATING, "eval", 0, READY_ENV), {
      exitCode: 0,
      annotation: null,
      summary: "- **Red-team eval**: PASSED",
    });
    const reported = outcomeForExit(INFORMATIONAL, "eval", 0, READY_ENV);
    assert.equal(reported.exitCode, 0);
    assert.match(reported.summary, /REPORTED — informational, no pass criterion/);
    assert.doesNotMatch(reported.summary, /PASSED/);
  });

  it("1 and any other code stay a failure with the same code, soft-fail or not", () => {
    assert.deepEqual(outcomeForExit(GATING, "eval", 1, READY_ENV), {
      exitCode: 1,
      annotation: null,
      summary: "- **Red-team eval**: FAILED (exit 1)",
    });
    assert.equal(outcomeForExit(GATING, "eval", 2, READY_ENV).exitCode, 2);
    assert.equal(outcomeForExit(GATING, "eval", 1, { ...READY_ENV, SAGE_EVAL_SOFT_FAIL: "1" }).exitCode, 1);
  });

  it("a killed process (no exit code) is a failure, never a pass", () => {
    const outcome = outcomeForExit(GATING, "eval", null, READY_ENV);
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.summary, /FAILED/);
  });

  it("3 is NOT RUN and fails the step unless SAGE_EVAL_SOFT_FAIL is 1", () => {
    const hard = outcomeForExit(GATING, "eval", 3, READY_ENV);
    assert.equal(hard.exitCode, 3);
    assert.match(hard.annotation ?? "", /^::warning::OpenRouter budget exhausted at runtime — Red-team eval NOT RUN/);
    assert.equal(hard.summary, "- **Red-team eval**: NOT RUN — OpenRouter budget exhausted at runtime");
    assert.equal(outcomeForExit(GATING, "eval", 3, { ...READY_ENV, SAGE_EVAL_SOFT_FAIL: "1" }).exitCode, 0);
    assert.equal(outcomeForExit(GATING, "eval", 3, { ...READY_ENV, SAGE_EVAL_BUDGET_SOFT_FAIL: "1" }).exitCode, 3);
  });

  it("4 is NOT RUN and fails the step unless SAGE_EVAL_SOFT_FAIL is 1", () => {
    const outcome = outcomeForExit(GATING, "eval", 4, READY_ENV);
    assert.equal(outcome.exitCode, 4);
    assert.match(outcome.annotation ?? "", /^::error::Red-team eval NOT RUN — OpenRouter/);
    assert.match(outcome.summary, /NOT RUN — OpenRouter key, model or connection unavailable$/);
    assert.equal(outcomeForExit(GATING, "eval", 4, { ...READY_ENV, SAGE_EVAL_SOFT_FAIL: "1" }).exitCode, 0);
  });

  it("names Gemini embeddings when the embedding check is what failed", () => {
    assert.match(outcomeForExit(EMBEDDING, "preflight", 4, READY_ENV).summary, /NOT RUN — Gemini embeddings key/);
    assert.match(outcomeForExit(EMBEDDING, "preflight", 3, READY_ENV).summary, /NOT RUN — Gemini embeddings budget/);
    assert.match(outcomeForExit(EMBEDDING, "preflight", 1, READY_ENV).summary, /FAILED \(embedding preflight exit 1\)/);
    assert.match(outcomeForExit(EMBEDDING, "recheck", 3, READY_ENV).summary, /budget exhausted at runtime, found after the eval failed$/);
  });
});

describe("runStep", () => {
  const fakeRunner = (codes: number[]) => {
    const calls: { command: readonly string[]; env: Env }[] = [];
    const run = async (command: readonly string[], env: Env) => {
      calls.push({ command, env });
      return codes[calls.length - 1] ?? 0;
    };
    return { run, calls };
  };

  it("never spawns anything for a skipped step", async () => {
    const { run, calls } = fakeRunner([]);
    const outcome = await runStep(GATING, {}, run);
    assert.equal(calls.length, 0);
    assert.match(outcome.summary, /NOT RUN/);
  });

  it("runs the command once and reports its exit code", async () => {
    const { run, calls } = fakeRunner([0]);
    const outcome = await runStep(GATING, READY_ENV, run);
    assert.deepEqual(calls.map((call) => call.command), [GATING.command]);
    assert.equal(outcome.summary, "- **Red-team eval**: PASSED");
  });

  it("checks the embedding key first, and stops there when it is refused", async () => {
    const { run, calls } = fakeRunner([4]);
    const stopped = await runStep(EMBEDDING, EMBEDDING_ENV, run);
    assert.deepEqual(calls.map((call) => call.command), [EMBEDDING_PREFLIGHT_COMMAND]);
    assert.equal(stopped.exitCode, 4);
    assert.match(stopped.summary, /NOT RUN — Gemini embeddings/);
  });

  it("never hands the OpenRouter key to the embedding check", async () => {
    const { run, calls } = fakeRunner([0, 0]);
    await runStep(EMBEDDING, EMBEDDING_ENV, run);
    assert.equal("OPENROUTER_API_KEY" in calls[0].env, false);
    assert.equal(calls[0].env.GEMINI_API_KEY, "AIza-test");
    assert.equal(calls[1].env.OPENROUTER_API_KEY, "sk-or-test");
  });

  it("reads a failed embedding eval as NOT RUN when the key stopped working mid-run", async () => {
    const drained = fakeRunner([0, 1, 3]);
    const outcome = await runStep(EMBEDDING, EMBEDDING_ENV, drained.run);
    assert.deepEqual(drained.calls.map((call) => call.command), [
      EMBEDDING_PREFLIGHT_COMMAND,
      EMBEDDING.command,
      EMBEDDING_PREFLIGHT_COMMAND,
    ]);
    assert.equal(outcome.exitCode, 3);
    assert.match(outcome.summary, /NOT RUN — Gemini embeddings budget exhausted at runtime, found after the eval failed/);
  });

  it("keeps a real failure a failure when the key still works", async () => {
    const real = fakeRunner([0, 1, 0]);
    assert.equal((await runStep(EMBEDDING, EMBEDDING_ENV, real.run)).summary, "- **Memory eval**: FAILED (exit 1)");
  });

  it("does not recheck after a pass, a NOT RUN, or for a step that does not embed", async () => {
    for (const evalCode of [0, 3, 4]) {
      const { run, calls } = fakeRunner([0, evalCode]);
      await runStep(EMBEDDING, EMBEDDING_ENV, run);
      assert.equal(calls.length, 2, `eval exit ${evalCode}`);
    }
    const gating = fakeRunner([1]);
    await runStep(GATING, READY_ENV, gating.run);
    assert.equal(gating.calls.length, 1);
  });
});

describe("the CLI propagates the outcome to the job", () => {
  const CLI = path.resolve("scripts/lib/sage-eval-ci-step.mjs");

  function runCli(childExit: number, env: Env) {
    const dir = mkdtempSync(path.join(tmpdir(), "sage-eval-ci-step-"));
    const summaryFile = path.join(dir, "summary.md");
    try {
      const result = spawnSync(
        process.execPath,
        [CLI, "--label=Fake eval", "--", process.execPath, "-e", `process.exit(${childExit})`],
        {
          encoding: "utf8",
          // Blank every variable the runner reads, so the runner's own
          // environment cannot decide the case.
          env: {
            ...process.env,
            OPENROUTER_API_KEY: "",
            GEMINI_API_KEY: "",
            SAGE_EVAL_REQUIRED: "",
            SAGE_EVAL_SOFT_FAIL: "",
            GITHUB_STEP_SUMMARY: summaryFile,
            ...env,
          },
        },
      );
      let summary = "";
      try {
        summary = readFileSync(summaryFile, "utf8");
      } catch {
        // No summary file means the CLI never wrote one; the assertions below say so.
      }
      return { code: result.status, stdout: result.stdout, summary };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("exits 4 and writes NOT RUN when the eval could not reach its provider", () => {
    const { code, stdout, summary } = runCli(4, READY_ENV);
    assert.equal(code, 4);
    assert.match(stdout, /::error::Fake eval NOT RUN/);
    assert.equal(summary, "- **Fake eval**: NOT RUN — OpenRouter key, model or connection unavailable\n");
  });

  it("exits 0 on a fork and 4 on this repository when the secret is absent, without running the eval", () => {
    const fork = runCli(1, {});
    assert.equal(fork.code, 0);
    assert.match(fork.summary, /NOT RUN — OPENROUTER_API_KEY secret not set/);
    const upstream = runCli(0, { SAGE_EVAL_REQUIRED: "true" });
    assert.equal(upstream.code, 4);
    assert.match(upstream.summary, /NOT RUN — OPENROUTER_API_KEY secret not set/);
  });
});
