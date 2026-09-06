import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTE_IDS, summarizeRouteSamples } from "./page-timing.mjs";

test("summarizeRouteSamples: p95 over ttfb and dcl independently, order-independent", () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({ ttfbMs: (i + 1) * 10, dclMs: (i + 1) * 20 }));
  const a = summarizeRouteSamples(samples);
  const b = summarizeRouteSamples([...samples].reverse());
  assert.equal(a.n, 20);
  assert.deepEqual(a, b);
  assert.ok(a.p95DclMs > a.p95TtfbMs, "dcl should be strictly after ttfb in this fixture");
});

test("summarizeRouteSamples: empty input reports zeros, not NaN", () => {
  assert.deepEqual(summarizeRouteSamples([]), { n: 0, p95TtfbMs: 0, p95DclMs: 0 });
});

test("ROUTE_IDS: matches the four routes the task brief names, no more and no fewer", () => {
  assert.deepEqual([...ROUTE_IDS].sort(), ["career", "dashboard", "teacher", "teacher_connect"]);
});
