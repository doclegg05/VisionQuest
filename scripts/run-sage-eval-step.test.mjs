import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.join(import.meta.dirname, "run-sage-eval-step.sh");

/** Runs the step script around `bash -c <shellCommand>` and returns what CI would see. */
function step(shellCommand, env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "vq-eval-step-"));
  const summary = path.join(dir, "summary.md");
  const marker = path.join(dir, "ran");
  try {
    const result = spawnSync("bash", [SCRIPT, "Red-team eval", "bash", "-c", `touch "${marker}"; ${shellCommand}`], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: summary, ...env },
    });
    return {
      code: result.status,
      output: `${result.stdout}${result.stderr}`,
      summary: existsSync(summary) ? readFileSync(summary, "utf8") : "",
      ran: existsSync(marker),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const KEY = { OPENROUTER_API_KEY: "test-key" };

describe("run-sage-eval-step.sh", () => {
  it("skips without running the eval when no OpenRouter key is configured", () => {
    const { code, output, summary, ran } = step("exit 0");
    assert.equal(code, 0);
    assert.equal(ran, false);
    assert.match(output, /::notice::OPENROUTER_API_KEY not set, skipping Red-team eval/);
    assert.match(summary, /\*\*Red-team eval\*\*: NOT RUN, OPENROUTER_API_KEY is not set/);
  });

  it("passes a clean run through", () => {
    const { code, summary, ran } = step("exit 0", KEY);
    assert.equal(code, 0);
    assert.equal(ran, true);
    assert.equal(summary, "");
  });

  it("passes a real eval failure through, without calling it not run", () => {
    const { code, output, summary } = step("exit 1", KEY);
    assert.equal(code, 1);
    assert.doesNotMatch(output, /NOT RUN/);
    assert.equal(summary, "");
  });

  it("marks exhausted credits as not run and still fails the step", () => {
    const { code, output, summary } = step("exit 3", KEY);
    assert.equal(code, 3);
    assert.match(output, /::warning::Red-team eval NOT RUN: OpenRouter credits or the key's spending limit ran out/);
    assert.match(summary, /\*\*Red-team eval\*\*: NOT RUN, OpenRouter credits or the key's spending limit ran out/);
  });

  it("marks an unavailable provider, model or key as not run and still fails the step", () => {
    const { code, output } = step("exit 4", KEY);
    assert.equal(code, 4);
    assert.match(output, /::warning::Red-team eval NOT RUN: OpenRouter, the model or the key was unavailable/);
  });

  it("lets SAGE_EVAL_SOFT_FAIL=1 pass a not-run step, and only a not-run step", () => {
    assert.equal(step("exit 3", { ...KEY, SAGE_EVAL_SOFT_FAIL: "1" }).code, 0);
    assert.equal(step("exit 4", { ...KEY, SAGE_EVAL_SOFT_FAIL: "1" }).code, 0);
    assert.equal(step("exit 1", { ...KEY, SAGE_EVAL_SOFT_FAIL: "1" }).code, 1);
  });
});
