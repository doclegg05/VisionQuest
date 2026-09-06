// Result objects and the JSON Schema they must satisfy. The schema is the
// contract every other reader (compare, the nightly workflow, the dashboard)
// depends on, so a malformed result must fail here rather than downstream.
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResult,
  loadResultSchema,
  validateResult,
  validateAgainstSchema,
} from "../lib/result.mjs";

const host = { os: "linux x64", cpus: 4, memGb: 16, node: "v22.0.0", ollama: null };

function sampleResult(overrides = {}) {
  return buildResult({
    suite: "demo",
    tier: "gate",
    startedAt: "2026-09-05T00:00:00.000Z",
    durationMs: 1234,
    commit: "abc1234",
    provider: null,
    model: null,
    host,
    metrics: [
      {
        id: "accuracy",
        value: 0.985,
        unit: "ratio",
        n: 200,
        floor: 0.98,
        baseline: 0.99,
        status: "pass",
      },
    ],
    ...overrides,
  });
}

test("buildResult produces every field the contract's example carries", () => {
  const result = sampleResult();
  assert.equal(result.suite, "demo");
  assert.equal(result.tier, "gate");
  assert.equal(result.startedAt, "2026-09-05T00:00:00.000Z");
  assert.equal(result.durationMs, 1234);
  assert.equal(result.commit, "abc1234");
  assert.equal(result.provider, null);
  assert.equal(result.model, null);
  assert.deepEqual(result.host, host);
  assert.equal(result.status, "pass");
  assert.equal(result.metrics[0].id, "accuracy");
});

test("buildResult derives the suite status from the worst metric status", () => {
  const result = sampleResult({
    metrics: [
      { id: "a", value: 1, unit: "ratio", status: "pass" },
      { id: "b", value: 0, unit: "ratio", status: "fail" },
    ],
  });
  assert.equal(result.status, "fail");
});

test("an explicit status wins over the derived one, for skipped and error suites", () => {
  const skipped = sampleResult({ status: "skipped", metrics: [] });
  assert.equal(skipped.status, "skipped");
  const errored = sampleResult({ status: "error", metrics: [], error: "boom" });
  assert.equal(errored.status, "error");
  assert.equal(errored.error, "boom");
});

test("a built result validates against the committed schema", () => {
  const errors = validateResult(sampleResult());
  assert.deepEqual(errors, []);
});

test("a skipped result with a reason validates", () => {
  const result = sampleResult({
    status: "skipped",
    metrics: [{ id: "accuracy", value: null, unit: "ratio", status: "skipped" }],
    skipped: "requires gemini (GEMINI_API_KEY)",
  });
  assert.deepEqual(validateResult(result), []);
});

test("the schema rejects an unknown status and a missing suite", () => {
  const bad = { ...sampleResult(), status: "greenish" };
  assert.ok(validateResult(bad).length > 0);
  const noSuite = sampleResult();
  delete noSuite.suite;
  assert.ok(validateResult(noSuite).length > 0);
});

test("the schema rejects a metric value that is a string", () => {
  const result = sampleResult();
  result.metrics[0].value = "0.985";
  const errors = validateResult(result);
  assert.ok(errors.some((e) => /value/.test(e)), errors.join("; "));
});

test("the schema forbids unknown top-level keys so drift is caught at the writer", () => {
  const result = { ...sampleResult(), surprise: true };
  const errors = validateResult(result);
  assert.ok(errors.some((e) => /surprise/.test(e)), errors.join("; "));
});

test("loadResultSchema reads the committed config/benchmarks/result.schema.json", () => {
  const schema = loadResultSchema();
  assert.equal(schema.type, "object");
  assert.ok(Array.isArray(schema.required));
  assert.ok(schema.required.includes("suite"));
});

test("the hand-rolled checker handles the schema subset the result schema uses", () => {
  const schema = {
    type: "object",
    required: ["a"],
    additionalProperties: false,
    properties: {
      a: { type: ["string", "null"] },
      b: { type: "integer", minimum: 0 },
      c: { enum: ["x", "y"] },
      d: { type: "array", items: { type: "number" } },
    },
  };
  assert.deepEqual(validateAgainstSchema({ a: null }, schema), []);
  assert.deepEqual(validateAgainstSchema({ a: "s", b: 3, c: "x", d: [1, 2] }, schema), []);
  assert.ok(validateAgainstSchema({}, schema).length > 0, "missing required");
  assert.ok(validateAgainstSchema({ a: 1 }, schema).length > 0, "wrong type");
  assert.ok(validateAgainstSchema({ a: "s", b: -1 }, schema).length > 0, "minimum");
  assert.ok(validateAgainstSchema({ a: "s", b: 1.5 }, schema).length > 0, "integer");
  assert.ok(validateAgainstSchema({ a: "s", c: "z" }, schema).length > 0, "enum");
  assert.ok(validateAgainstSchema({ a: "s", d: ["n"] }, schema).length > 0, "item type");
  assert.ok(validateAgainstSchema({ a: "s", e: 1 }, schema).length > 0, "additionalProperties");
});
