import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { EVALS, classifyExit, compareModels, formatTable, parseArgs, sumCostLog } from "./sage-models-compare.mjs";

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

describe("classifyExit", () => {
  it("maps eval exit codes", () => {
    assert.equal(classifyExit(0), "pass");
    assert.equal(classifyExit(1), "fail");
    assert.equal(classifyExit(3), "not_run");
    assert.equal(classifyExit(2), "error");
  });
});

describe("sumCostLog", () => {
  it("adds one billed cost per line and skips lines that are not a cost", () => {
    assert.equal(sumCostLog("0.1\n0.25\n\nnot a number\n-1\n0.000005\n"), 0.350005);
  });

  it("reports an unknown cost when no log was written", () => {
    assert.equal(sumCostLog(null), null);
  });
});

/** In-memory cost logs: runEval appends to the log it is given, as an eval process would. */
function fakeCostLogs() {
  const files = new Map();
  return {
    files,
    costLogFor: (model, index) => `/logs/${index}-${model}`,
    readCostLog: (file) => files.get(file) ?? null,
    append: (file, cost) => files.set(file, `${files.get(file) ?? ""}${cost}\n`),
  };
}

describe("compareModels", () => {
  it("runs every eval per model and charges each model the costs in its own log", async () => {
    const logs = fakeCostLogs();
    const runs = [];
    const result = await compareModels({
      models: ["a", "b"],
      evals: EVALS.slice(0, 2),
      runEval: async (evalSpec, model, costLog) => {
        runs.push(`${model}:${evalSpec.id}:${costLog}`);
        logs.append(costLog, model === "a" ? 0.05 : 0.125);
        // Another comparison on the same key, billed at the same moment, must not count.
        logs.append("/logs/someone-else", 9.99);
        return model === "b" && evalSpec.id === "harness" ? 1 : 0;
      },
      costLogFor: logs.costLogFor,
      readCostLog: logs.readCostLog,
    });
    assert.deepEqual(runs, ["a:redteam:/logs/0-a", "a:harness:/logs/0-a", "b:redteam:/logs/1-b", "b:harness:/logs/1-b"]);
    assert.equal(result.stoppedEarly, false);
    assert.deepEqual(result.rows, [
      { model: "a", outcomes: [{ eval: "redteam", outcome: "pass" }, { eval: "harness", outcome: "pass" }], costUsd: 0.1 },
      { model: "b", outcomes: [{ eval: "redteam", outcome: "pass" }, { eval: "harness", outcome: "fail" }], costUsd: 0.25 },
    ]);
  });

  it("reports an unknown cost for a model whose evals made no billed call", async () => {
    const logs = fakeCostLogs();
    const result = await compareModels({
      models: ["a"],
      evals: EVALS.slice(0, 1),
      runEval: async () => 4,
      costLogFor: logs.costLogFor,
      readCostLog: logs.readCostLog,
    });
    assert.deepEqual(result.rows, [{ model: "a", outcomes: [{ eval: "redteam", outcome: "error" }], costUsd: null }]);
  });

  it("stops the whole comparison when credits run out", async () => {
    const logs = fakeCostLogs();
    const runs = [];
    const result = await compareModels({
      models: ["a", "b"],
      evals: EVALS.slice(0, 2),
      runEval: async (evalSpec, model) => {
        runs.push(`${model}:${evalSpec.id}`);
        return 3;
      },
      costLogFor: logs.costLogFor,
      readCostLog: logs.readCostLog,
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
