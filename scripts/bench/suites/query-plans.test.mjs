import { test } from "node:test";
import assert from "node:assert/strict";
import { collectSeqScans, planTotalCost } from "./query-plans.mjs";

test("collectSeqScans: finds a Seq Scan at the root", () => {
  const plan = { "Node Type": "Seq Scan", "Relation Name": "Student", "Total Cost": 12.3 };
  assert.deepEqual(collectSeqScans(plan), ["Student"]);
});

test("collectSeqScans: finds Seq Scans nested under joins, ignores Index Scans", () => {
  const plan = {
    "Node Type": "Hash Join",
    Plans: [
      { "Node Type": "Seq Scan", "Relation Name": "Connection" },
      {
        "Node Type": "Hash",
        Plans: [{ "Node Type": "Index Scan", "Relation Name": "Employer" }],
      },
    ],
  };
  assert.deepEqual(collectSeqScans(plan), ["Connection"]);
});

test("collectSeqScans: a plan with no Seq Scan anywhere returns an empty list", () => {
  const plan = {
    "Node Type": "Nested Loop",
    Plans: [
      { "Node Type": "Index Scan", "Relation Name": "Student" },
      { "Node Type": "Index Scan", "Relation Name": "Goal" },
    ],
  };
  assert.deepEqual(collectSeqScans(plan), []);
});

test("collectSeqScans: null/undefined/non-object input returns an empty list, not a throw", () => {
  assert.deepEqual(collectSeqScans(null), []);
  assert.deepEqual(collectSeqScans(undefined), []);
  assert.deepEqual(collectSeqScans("not a plan"), []);
});

test("collectSeqScans: the same relation scanned twice under one plan is reported twice (caller dedupes if it wants a set)", () => {
  const plan = {
    "Node Type": "Append",
    Plans: [
      { "Node Type": "Seq Scan", "Relation Name": "OutboundMessage" },
      { "Node Type": "Seq Scan", "Relation Name": "OutboundMessage" },
    ],
  };
  assert.deepEqual(collectSeqScans(plan), ["OutboundMessage", "OutboundMessage"]);
});

test("planTotalCost: reads the root node's Total Cost", () => {
  assert.equal(planTotalCost({ "Node Type": "Seq Scan", "Total Cost": 42.5 }), 42.5);
});

test("planTotalCost: missing or non-numeric Total Cost returns null, not NaN or 0", () => {
  assert.equal(planTotalCost({}), null);
  assert.equal(planTotalCost({ "Total Cost": "not a number" }), null);
  assert.equal(planTotalCost(null), null);
});
