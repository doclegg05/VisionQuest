import { test } from "node:test";
import assert from "node:assert/strict";
import { queueWaitMs, summarizeDurations } from "./classroom-concurrency.mjs";

test("summarizeDurations: p50/p95 over a sorted set, order-independent", () => {
  const values = Array.from({ length: 15 }, (_, i) => (i + 1) * 1000); // 1000..15000
  const a = summarizeDurations(values);
  const b = summarizeDurations([...values].reverse());
  assert.equal(a.n, 15);
  assert.deepEqual(a, b);
  assert.ok(a.p95Ms >= a.p50Ms);
});

test("summarizeDurations: empty input reports zeros, not NaN", () => {
  assert.deepEqual(summarizeDurations([]), { n: 0, p50Ms: 0, p95Ms: 0 });
});

test("queueWaitMs: a slower level than the baseline reports the positive gap", () => {
  assert.equal(queueWaitMs(21000, 20000), 1000);
});

test("queueWaitMs: a level at or faster than the baseline floors at 0, never negative", () => {
  assert.equal(queueWaitMs(20000, 20000), 0);
  assert.equal(queueWaitMs(19000, 20000), 0);
});
