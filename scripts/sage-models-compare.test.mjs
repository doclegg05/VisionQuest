import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EVALS, classifyExit, compareModels, costDelta, formatTable, parseArgs, readKeyUsage } from "./sage-models-compare.mjs";

describe("parseArgs", () => {
  it("reads models and defaults to every CI-gated eval", () => {
    const { models, evals } = parseArgs(["--models=a/one, b/two"]);
    assert.deepEqual(models, ["a/one", "b/two"]);
    assert.deepEqual(evals.map((e) => e.id), ["redteam", "harness", "agent"]);
  });

  it("leaves out the quality eval, which has no pass criterion without its judge", () => {
    assert.throws(() => parseArgs(["--models=a", "--evals=quality"]), /Unknown --evals: quality/);
  });

  it("narrows to the evals asked for and rejects unknown ones", () => {
    assert.deepEqual(parseArgs(["--models=a", "--evals=agent"]).evals.map((e) => e.id), ["agent"]);
    assert.throws(() => parseArgs(["--models=a", "--evals=agent,vibes"]), /Unknown --evals: vibes/);
  });

  it("requires at least one model", () => {
    assert.throws(() => parseArgs([]), /--models=/);
  });
});

describe("classifyExit and costDelta", () => {
  it("maps eval exit codes", () => {
    assert.equal(classifyExit(0), "pass");
    assert.equal(classifyExit(1), "fail");
    assert.equal(classifyExit(3), "not_run");
    assert.equal(classifyExit(2), "error");
  });

  it("subtracts key usage, or reports null when a reading is missing", () => {
    assert.equal(costDelta(1.25, 1.5), 0.25);
    assert.equal(costDelta(null, 1.5), null);
  });
});

describe("readKeyUsage", () => {
  it("reads usage from GET /api/v1/key with the bearer key", async () => {
    let seen = null;
    const fetchImpl = async (url, init) => {
      seen = { url, auth: init.headers.Authorization };
      return new Response(JSON.stringify({ data: { usage: 0.42 } }), { status: 200 });
    };
    assert.equal(await readKeyUsage("sk-or-test", fetchImpl), 0.42);
    assert.deepEqual(seen, { url: "https://openrouter.ai/api/v1/key", auth: "Bearer sk-or-test" });
  });

  it("fails loudly on a bad key", async () => {
    const fetchImpl = async () => new Response("{}", { status: 401 });
    await assert.rejects(readKeyUsage("sk-or-test", fetchImpl), /401/);
  });
});

describe("compareModels", () => {
  it("runs every eval per model and records each model's spend", async () => {
    const usage = [0, 0.1, 0.1, 0.35];
    const runs = [];
    const result = await compareModels({
      models: ["a", "b"],
      evals: EVALS.slice(0, 2),
      runEval: async (evalSpec, model) => {
        runs.push(`${model}:${evalSpec.id}`);
        return model === "b" && evalSpec.id === "harness" ? 1 : 0;
      },
      readUsage: async () => usage.shift(),
    });
    assert.deepEqual(runs, ["a:redteam", "a:harness", "b:redteam", "b:harness"]);
    assert.equal(result.stoppedEarly, false);
    assert.deepEqual(result.rows, [
      { model: "a", outcomes: [{ eval: "redteam", outcome: "pass" }, { eval: "harness", outcome: "pass" }], costUsd: 0.1 },
      { model: "b", outcomes: [{ eval: "redteam", outcome: "pass" }, { eval: "harness", outcome: "fail" }], costUsd: 0.25 },
    ]);
  });

  it("stops the whole comparison when credits run out", async () => {
    const runs = [];
    const result = await compareModels({
      models: ["a", "b"],
      evals: EVALS.slice(0, 2),
      runEval: async (evalSpec, model) => {
        runs.push(`${model}:${evalSpec.id}`);
        return 3;
      },
      readUsage: async () => 0,
    });
    assert.deepEqual(runs, ["a:redteam"]);
    assert.equal(result.stoppedEarly, true);
  });
});

describe("formatTable", () => {
  it("lines up models, outcomes and cost", () => {
    const table = formatTable(
      [{ model: "a", outcomes: [{ eval: "redteam", outcome: "pass" }], costUsd: 0.1234 }],
      EVALS.slice(0, 2),
    );
    const lines = table.split("\n");
    assert.match(lines[0], /^model\s+redteam\s+harness\s+cost_usd$/);
    assert.match(lines[2], /^a\s+pass\s+-\s+0\.1234$/);
  });
});
