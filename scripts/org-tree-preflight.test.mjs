import assert from "node:assert/strict";
import { test } from "node:test";
import { PREFLIGHT_COUNTS, formatCounts, isSelectOnly } from "./lib/org-tree-preflight.mjs";

test("every preflight statement is a single SELECT", () => {
  assert.ok(PREFLIGHT_COUNTS.length >= 6);
  for (const { sql } of PREFLIGHT_COUNTS) assert.ok(isSelectOnly(sql), sql);
});

test("isSelectOnly refuses writes and stacked statements", () => {
  assert.equal(isSelectOnly("DELETE FROM x"), false);
  assert.equal(isSelectOnly("SELECT 1; DROP TABLE x"), false);
  assert.equal(isSelectOnly("UPDATE x SET y = 1"), false);
});

test("statements select only a count", () => {
  for (const { sql } of PREFLIGHT_COUNTS) {
    assert.match(sql, /^SELECT count\(\*\)::int AS n FROM /);
    assert.doesNotMatch(sql, /"(displayName|email)"/);
  }
});

test("formatCounts prints integers only", () => {
  assert.equal(formatCounts([{ label: "a", n: 3 }, { label: "b", n: 0 }]), "a: 3\nb: 0");
  assert.throws(() => formatCounts([{ label: "a", n: "Jane" }]));
  assert.throws(() => formatCounts([{ label: "a", n: -1 }]));
  assert.throws(() => formatCounts([{ label: "a", n: 1.5 }]));
});
