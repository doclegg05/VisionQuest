import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHost, resolveRoleModel, roleMetric } from "./model-bakeoff.mjs";

test("buildHost: passes through ctx.host and adds the two env knobs, never throwing with no ctx.host at all", () => {
  const host = buildHost({}, null);
  assert.equal(host.ollama, null);
  assert.equal(typeof host.OLLAMA_NUM_PARALLEL, "string");
  assert.equal(typeof host.OLLAMA_KEEP_ALIVE, "string");
});

test("buildHost: keeps ctx.host's fields (os/cpus/memGb/node) untouched", () => {
  const ctx = { host: { os: "linux x64", cpus: 8, memGb: 16, node: "v24.0.0", ollama: null } };
  const host = buildHost(ctx, null);
  assert.equal(host.os, "linux x64");
  assert.equal(host.cpus, 8);
  assert.equal(host.memGb, 16);
  assert.equal(host.node, "v24.0.0");
});

test("buildHost: prefers an already-probed ctx.host.ollama over the passed-in probe result", () => {
  const ctx = { host: { ollama: "0.32.4" } };
  const host = buildHost(ctx, "9.9.9-should-not-win");
  assert.equal(host.ollama, "0.32.4");
});

test("buildHost: falls back to the passed-in probe result when ctx.host.ollama is not set (the --self-test case)", () => {
  const ctx = { host: { os: "linux x64" } };
  const host = buildHost(ctx, "0.32.4");
  assert.equal(host.ollama, "0.32.4");
});

test("buildHost: records configured OLLAMA_NUM_PARALLEL / OLLAMA_KEEP_ALIVE verbatim", () => {
  const before = { p: process.env.OLLAMA_NUM_PARALLEL, k: process.env.OLLAMA_KEEP_ALIVE };
  process.env.OLLAMA_NUM_PARALLEL = "4";
  process.env.OLLAMA_KEEP_ALIVE = "30m";
  try {
    const host = buildHost({}, null);
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
