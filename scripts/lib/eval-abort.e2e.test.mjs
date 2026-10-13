import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * A run that cannot evaluate anything must say so with its exit code, not
 * report a failed test: 3 when credits or the key limit ran out, 4 when the
 * provider or model is unavailable. sage:models:compare and CI both key on
 * these codes. Each eval script swallowed provider errors per case, so before
 * this test these runs exited 1 (or 0) instead.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const PRELOAD = path.join(REPO_ROOT, "scripts/lib/test-fixtures/stub-openrouter-fetch.mjs");
const LOOPBACK_DB = "postgresql://none@127.0.0.1:1/none";

function runEval(script, extraArgs, status) {
  const result = spawnSync(
    "npx",
    ["tsx", "--import", PRELOAD, script, "--provider=openrouter", ...extraArgs],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: {
        ...process.env,
        STUB_OPENROUTER_STATUS: String(status),
        OPENROUTER_API_KEY: "sk-or-test-dummy-key-0123456789",
        // Non-empty loopback values, so loadEnvFile cannot fill them from a
        // .env.local that points at production.
        DATABASE_URL: LOOPBACK_DB,
        DIRECT_URL: LOOPBACK_DB,
        ADMIN_DATABASE_URL: LOOPBACK_DB,
        BENCH_PROD_READONLY_URL: LOOPBACK_DB,
      },
    },
  );
  return { code: result.status, output: `${result.stdout}\n${result.stderr}` };
}

const SCRIPTS = [
  ["scripts/sage-redteam-eval.mjs", []],
  ["scripts/sage-chat-harness.mjs", ["--families=guardrail"]],
  ["scripts/sage-agent-eval.mjs", []],
  ["scripts/sage-quality-eval.mjs", []],
];

describe("eval runs that cannot evaluate exit with 'not run' codes", () => {
  for (const [script, args] of SCRIPTS) {
    it(`${path.basename(script)} exits 3 when OpenRouter credits run out`, () => {
      const { code, output } = runEval(script, args, 402);
      assert.equal(code, 3, output.slice(-1500));
      assert.match(output, /OpenRouter budget exhausted/);
    });
  }

  it("sage-agent-eval.mjs exits 4 when the model is unavailable", () => {
    const { code, output } = runEval("scripts/sage-agent-eval.mjs", [], 404);
    assert.equal(code, 4, output.slice(-1500));
    assert.match(output, /provider or model unavailable/);
  });
});

describe("sage-memory-eval checks the provider before touching the database", () => {
  it("refuses a non-local database before any delete runs", () => {
    const remote = "postgresql://app:pw@db.unreachable.invalid:5432/postgres";
    const result = spawnSync("npx", ["tsx", "scripts/sage-memory-eval.mjs", "--provider=openrouter"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: {
        ...process.env,
        OPENROUTER_API_KEY: "sk-or-test-dummy-key-0123456789",
        DATABASE_URL: remote,
        DIRECT_URL: LOOPBACK_DB,
        ADMIN_DATABASE_URL: LOOPBACK_DB,
        BENCH_PROD_READONLY_URL: LOOPBACK_DB,
      },
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /refuses to run with a non-local database in DATABASE_URL/, output.slice(-1500));
    assert.doesNotMatch(output, /PrismaClient|Can't reach database|P1001/, output.slice(-1500));
    assert.notEqual(result.status, 0);
  });
});
