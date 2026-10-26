import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHotQueries, collectSeqScans, planTotalCost } from "./query-plans.mjs";

const BENCH = {
  instructorId: "cbenchinstr1",
  instructorLogin: "bench-instructor-1",
  studentId: "cbenchstu01",
};

test("buildHotQueries: with `studentIds` provided, builds all 6 descriptors without touching a database (no DATABASE_URL needed)", async () => {
  // No DATABASE_URL is set anywhere in this process for this test — if
  // buildHotQueries reached for connectManagedStudentIds() instead of the
  // provided studentIds, it would throw here (real Prisma call, no context,
  // no connection string), not silently pass.
  const descriptors = await buildHotQueries({ bench: BENCH, studentIds: ["cbenchstu01", "cbenchstu02"] });
  assert.equal(descriptors.length, 6);
  const names = descriptors.map((d) => d.name).sort();
  assert.deepEqual(names, [
    "connect_console_lead_list",
    "dashboard_bundle_certifications",
    "dashboard_bundle_progression_events",
    "funnel_report",
    "intervention_queue",
    "weekly_nudge_roster",
  ]);
  for (const d of descriptors) {
    assert.equal(typeof d.name, "string");
    assert.equal(typeof d.model, "string");
    assert.equal(typeof d.args, "object");
  }
});

test("buildHotQueries: the provided studentIds parameterize the funnel_report descriptor directly", async () => {
  const descriptors = await buildHotQueries({ bench: BENCH, studentIds: ["cbenchstu01", "cbenchstu02"] });
  const funnel = descriptors.find((d) => d.name === "funnel_report");
  assert.deepEqual(funnel.args.where.studentId.in, ["cbenchstu01", "cbenchstu02"]);
});

test("buildHotQueries: an empty provided studentIds list still builds a valid (non-matching) funnel_report where clause, not an unfiltered scan", async () => {
  const descriptors = await buildHotQueries({ bench: BENCH, studentIds: [] });
  const funnel = descriptors.find((d) => d.name === "funnel_report");
  // Mirrors the run()-time guard against an unbounded `studentId: { in: [] }`
  // (which Postgres treats as "matches nothing" anyway, but a query plan for
  // "matches nothing" is not a useful EXPLAIN sample) — see the funnel_report
  // descriptor's own fallback in the source.
  assert.ok(Array.isArray(funnel.args.where.studentId.in));
  assert.ok(funnel.args.where.studentId.in.length > 0);
});

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
