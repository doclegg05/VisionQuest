import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
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

  for (const [script, args] of SCRIPTS) {
    it(`${path.basename(script)} exits 4 when OpenRouter cannot be reached at all`, () => {
      // Before 2026-10-14 every case was graded as a miss: the agent eval
      // printed "0.0% (0/45)" and exited 0, and the run took two minutes of
      // retries against a dead connection.
      const { code, output } = runEval(script, args, "network");
      assert.equal(code, 4, output.slice(-1500));
      assert.match(output, /OpenRouter could not be reached/);
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

/** Runs sage:models:compare on the harness eval with every OpenRouter call billed at costUsd. */
function runCompare(costUsd) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", "scripts/sage-models-compare.mjs", "--models=stub/model", "--evals=harness"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${PRELOAD}`,
        STUB_OPENROUTER_STATUS: "ok",
        STUB_OPENROUTER_COST: String(costUsd),
        OPENROUTER_API_KEY: "stub-key",
        DATABASE_URL: LOOPBACK_DB,
        DIRECT_URL: LOOPBACK_DB,
        ADMIN_DATABASE_URL: LOOPBACK_DB,
        BENCH_PROD_READONLY_URL: LOOPBACK_DB,
      },
    });
    let output = "";
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

describe("sage-models-compare charges each model only for its own calls", () => {
  it("keeps two comparisons running at the same time from counting each other's spend", async () => {
    // On 2026-10-14 eight comparisons on one key each reported the key's total
    // movement, $1.18 to $4.19 per model against $0.08 to $1.54 billed.
    const runs = await Promise.all([runCompare(0.0005), runCompare(0.0007)]);
    try {
      const calls = runs.map(({ code, output }, index) => {
        assert.equal(code, 0, output.slice(-1500));
        const cost = Number(output.match(/^stub\/model\s+\S+\s+([\d.]+)$/m)?.[1]);
        const perCall = [0.0005, 0.0007][index];
        assert.ok(cost > 0, `no cost in the table:\n${output.slice(-1500)}`);
        return cost / perCall;
      });
      // Same eval, same stub, so both runs made the same number of calls; a
      // run that counted the other's spend would not divide evenly.
      assert.ok(Math.abs(calls[0] - Math.round(calls[0])) < 1e-6, `run 1 cost is not a whole number of calls: ${calls[0]}`);
      assert.equal(Math.round(calls[0]), Math.round(calls[1]));
      assert.ok(Math.abs(calls[1] - Math.round(calls[1])) < 1e-6, `run 2 cost is not a whole number of calls: ${calls[1]}`);
    } finally {
      for (const { output } of runs) {
        const report = output.match(/^Wrote (\S+\.json)$/m)?.[1];
        if (report) rmSync(path.join(REPO_ROOT, report), { force: true });
      }
    }
  });
});
