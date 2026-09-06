import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { summarizeLatencies, roleToStagePersona, readCloudChatP95Floor } from "./sage-latency.mjs";

test("summarizeLatencies: computes p50/p95/max over a sorted set", () => {
  const latencies = Array.from({ length: 20 }, (_, i) => (i + 1) * 100); // 100..2000
  const summary = summarizeLatencies(latencies);
  assert.equal(summary.n, 20);
  assert.equal(summary.maxMs, 2000);
  assert.ok(summary.p95Ms >= summary.p50Ms);
});

test("summarizeLatencies: empty input reports zeros, not NaN", () => {
  const summary = summarizeLatencies([]);
  assert.equal(summary.n, 0);
  assert.equal(summary.p50Ms, 0);
  assert.equal(summary.p95Ms, 0);
  assert.equal(summary.maxMs, 0);
});

test("summarizeLatencies: input order does not matter", () => {
  const a = summarizeLatencies([300, 100, 200]);
  const b = summarizeLatencies([100, 200, 300]);
  assert.deepEqual(a, b);
});

test("roleToStagePersona: maps teacher/admin explicitly, everything else to student", () => {
  assert.equal(roleToStagePersona("teacher"), "teacher");
  assert.equal(roleToStagePersona("admin"), "admin");
  assert.equal(roleToStagePersona("student"), "student");
  assert.equal(roleToStagePersona(undefined), "student");
});

test("readCloudChatP95Floor: reads the bar from config/sage-slo.json rather than a hard-coded number", () => {
  const floor = readCloudChatP95Floor("config/sage-slo.json");
  assert.equal(typeof floor, "number");
  assert.ok(floor > 0);
});

test("readCloudChatP95Floor: throws a clear error when the SLO file has no bar for this call site", () => {
  const tmp = join(tmpdir(), `sage-latency-slo-test-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify({ perProviderP95Ms: {} }));
  try {
    assert.throws(() => readCloudChatP95Floor(tmp), /no perProviderP95Ms\.sage_chat\.gemini bar/);
  } finally {
    rmSync(tmp);
  }
});
