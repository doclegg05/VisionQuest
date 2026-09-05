import { test } from "node:test";
import assert from "node:assert/strict";
import { recordHost, resolveRoleModel, roleMetric } from "./model-bakeoff.mjs";

test("recordHost: always returns every field, never throws, even with no OLLAMA_* env set", () => {
  const host = recordHost();
  assert.equal(typeof host.platform, "string");
  assert.equal(typeof host.arch, "string");
  assert.equal(typeof host.cpuCount, "number");
  assert.ok(host.cpuCount > 0);
  assert.equal(typeof host.memGb, "number");
  assert.ok(host.memGb > 0);
  // OLLAMA_NUM_PARALLEL / OLLAMA_KEEP_ALIVE: "(unset)" not undefined, so the
  // artifact JSON always shows the field was checked, not merely absent.
  assert.equal(typeof host.OLLAMA_NUM_PARALLEL, "string");
  assert.equal(typeof host.OLLAMA_KEEP_ALIVE, "string");
});

test("recordHost: records configured OLLAMA_NUM_PARALLEL / OLLAMA_KEEP_ALIVE verbatim", () => {
  const before = { p: process.env.OLLAMA_NUM_PARALLEL, k: process.env.OLLAMA_KEEP_ALIVE };
  process.env.OLLAMA_NUM_PARALLEL = "4";
  process.env.OLLAMA_KEEP_ALIVE = "30m";
  try {
    const host = recordHost();
    assert.equal(host.OLLAMA_NUM_PARALLEL, "4");
    assert.equal(host.OLLAMA_KEEP_ALIVE, "30m");
  } finally {
    if (before.p === undefined) delete process.env.OLLAMA_NUM_PARALLEL;
    else process.env.OLLAMA_NUM_PARALLEL = before.p;
    if (before.k === undefined) delete process.env.OLLAMA_KEEP_ALIVE;
    else process.env.OLLAMA_KEEP_ALIVE = before.k;
  }
});

test("resolveRoleModel: a per-role env var wins over the shared one", () => {
  const model = resolveRoleModel("chat", { BENCH_BAKEOFF_MODEL_CHAT: "gemma4:12b", BENCH_BAKEOFF_MODEL: "gemma4:e4b" });
  assert.equal(model, "gemma4:12b");
});

test("resolveRoleModel: falls back to the shared BENCH_BAKEOFF_MODEL when no per-role var is set", () => {
  const model = resolveRoleModel("draft", { BENCH_BAKEOFF_MODEL: "gemma4:e4b" });
  assert.equal(model, "gemma4:e4b");
});

test("resolveRoleModel: null when neither is set — 'no model assigned to any role yet' is a real, expected state", () => {
  assert.equal(resolveRoleModel("extract", {}), null);
});

test("roleMetric: an unconfigured role is null (not 0) with its skip reason recorded", () => {
  const metric = roleMetric("chat", null, "no candidate model configured", { host: true }, "reports/x.json");
  assert.equal(metric.id, "chat_score");
  assert.equal(metric.value, null);
  assert.equal(metric.details.skipped, "no candidate model configured");
  assert.deepEqual(metric.details.host, { host: true });
});

test("roleMetric: a scored role reports passed/total as a ratio", () => {
  const roleRun = { model: "gemma4:12b", results: [{ pass: true }, { pass: true }, { pass: false }] };
  const metric = roleMetric("draft", roleRun, null, {}, "reports/x.json");
  assert.equal(metric.value, 2 / 3);
  assert.equal(metric.n, 3);
  assert.equal(metric.details.passed, 2);
  assert.equal(metric.details.total, 3);
});

test("roleMetric: zero cases for a configured role is null, not 0 — nothing was scored, so it did not fail", () => {
  const roleRun = { model: "gemma4:12b", results: [] };
  const metric = roleMetric("document", roleRun, null, {}, "reports/x.json");
  assert.equal(metric.value, null);
  assert.equal(metric.n, 0);
});
