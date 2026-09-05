#!/usr/bin/env node
// =============================================================================
// query-plans — EXPLAIN the hot queries; 0 sequential scans on large tables.
//
// Cannot run in this authoring container: no local Postgres (requires:
// ["postgres","cohort"]). Meant to run in CI's hermetic pgvector service
// inside the `bench -- --tier=gate --compare` step, after
// scripts/bench/seed-cohort.ts has seeded the synthetic cohort (see ci.yml's
// "Seed the synthetic benchmark cohort" step in the verify job).
//
// CAPTURING REAL SQL, NEVER HAND-WRITTEN. Every model in this codebase
// hard-imports the shared `prisma`/`prismaAdmin` singletons (src/lib/db.ts)
// with no dependency injection anywhere, so there is no way to attach a
// `$on("query")` listener to the exact client instance a production
// function like `listLeads()` or `fetchConnectFunnel()` uses without either
// editing src/lib/db.ts (out of this suite's ownership — a shared,
// RLS-security-relevant file many other builders depend on) or relying on
// Prisma's undocumented DEBUG-env timing (unverifiable without a real DB
// here). Instead: a FRESH, purpose-built PrismaClient is constructed here
// with `log: [{ emit: "event", level: "query" }]`, and each "hot query" is
// re-issued through IT using the SAME arguments production code builds —
// imported directly from their real source (LEAD_LIST_SELECT,
// interventionQueueStudentSelect, buildManagedStudentWhere,
// connectManagedStudentIds, reportDateRangeBoundsUtc, intersectScopeClassIds)
// wherever those are pure or already exported, with the where/select/orderBy
// LITERALS documented as mirroring one specific production call site when a
// helper is not exported. Prisma generates byte-identical SQL for an
// identical query shape regardless of which client instance issues it — the
// `log` config affects observability, not SQL generation — so this captures
// the REAL SQL, never a hand-written stand-in, without touching db.ts or any
// other builder's files beyond the one-line `export` added to
// interventionQueueStudentSelect in src/lib/teacher/dashboard.ts.
//
// The five hot queries (task brief): the Connect console lead list
// (listLeads, src/lib/connect/leads.ts), the intervention queue
// (getInterventionQueue, src/lib/teacher/dashboard.ts), the student
// dashboard bundle (two of assembleStudentContextBundle's nine parallel
// reads, src/lib/sage/context-bundle.ts — certification, the most
// join-heavy, and progressionEvent, the most time-windowed/append-only),
// the weekly nudge roster (planWeeklyJobsNudges, src/lib/nudges/
// schedule.ts), and the funnel report (fetchConnectFunnel, src/lib/connect/
// funnel.ts).
//
// "LARGE TABLES": the seeded cohort is 50 students — no seeded table is
// anywhere near production scale, so gating on `Seq Scan` by TABLE NAME
// alone would flag Postgres's normal, CORRECT choice to scan a 50-row table
// rather than use an index (cheaper at that size regardless of what indexes
// exist). Gating on ACTUAL row count instead (via pg_stat_user_tables'
// n_live_tup after an explicit ANALYZE, threshold 10,000 per design SS4.7)
// means this metric is HONEST about what the fixture can prove: on the
// standard cohort it should read 0 because nothing IS large yet, not
// because indexes are correct. A meaningful non-trivial signal needs a
// larger seed — tracked as a follow-up, not invented here by faking scale.
//
//   DATABASE_URL=... npx tsx scripts/bench/seed-cohort.ts
//   DATABASE_URL=... node --import tsx scripts/bench/suites/query-plans.mjs --self-test
// =============================================================================

import { selfTest } from "../lib/self-test.mjs";

const LARGE_TABLE_ROW_THRESHOLD = 10_000;

/** Walks an EXPLAIN (FORMAT JSON) plan tree, collecting every Seq Scan's relation name. */
export function collectSeqScans(planNode, out = []) {
  if (!planNode || typeof planNode !== "object") return out;
  if (planNode["Node Type"] === "Seq Scan" && typeof planNode["Relation Name"] === "string") {
    out.push(planNode["Relation Name"]);
  }
  for (const child of planNode.Plans ?? []) collectSeqScans(child, out);
  return out;
}

/** The plan's own top-level estimated total cost — Postgres always sets this on the root node. */
export function planTotalCost(planNode) {
  return typeof planNode?.["Total Cost"] === "number" ? planNode["Total Cost"] : null;
}

/**
 * Builds each hot query's {model, args} using real production
 * pure-helpers/constants — see the file header for why. Returns a plain
 * descriptor list rather than executing anything, so the shape is
 * unit-testable without a database (see query-plans.test.mjs).
 */
export async function buildHotQueries({ bench }) {
  const { LEAD_LIST_SELECT, MAX_LEAD_PAGE } = await import("../../../src/lib/connect/leads.ts");
  const { interventionQueueStudentSelect } = await import("../../../src/lib/teacher/dashboard.ts");
  const { buildManagedStudentWhere } = await import("../../../src/lib/classroom.ts");
  const { connectManagedStudentIds, MAX_CONNECT_REPORT_ROWS } = await import(
    "../../../src/lib/connect/classes.ts"
  );
  const { reportDateRangeBoundsUtc } = await import("../../../src/lib/timezone.ts");
  const { intersectScopeClassIds } = await import("../../../src/lib/connect/flags-shared.ts");

  const instructorSession = {
    id: bench.instructorId,
    studentId: bench.instructorLogin,
    displayName: "Bench Instructor",
    role: "teacher",
  };
  const now = new Date();

  // Real ids from the seeded cohort, via the real (pure-ish, DB-reading)
  // production helper — not one of the "5 hot queries" itself, so it is
  // allowed to run on the app's own client uncaptured; it just needs to
  // return realistic ids to parameterize the funnel query below with.
  const studentIds = await connectManagedStudentIds(instructorSession, undefined);
  const { from, to } = reportDateRangeBoundsUtc(undefined, undefined);
  const scopedClassIds = intersectScopeClassIds({ mode: "all" }, { mode: "all" }); // null: both scopes "all"

  return [
    {
      name: "connect_console_lead_list",
      model: "jobLead",
      // Mirrors listLeads()'s no-filter default path (src/lib/connect/
      // leads.ts) — that function hard-imports `prisma` and cannot be
      // redirected to a capturing client without editing it or db.ts.
      args: {
        where: {},
        orderBy: [{ status: "asc" }, { postedAt: "desc" }, { id: "asc" }],
        take: Math.min(MAX_LEAD_PAGE, MAX_LEAD_PAGE),
        select: LEAD_LIST_SELECT,
      },
    },
    {
      name: "intervention_queue",
      model: "student",
      args: {
        where: buildManagedStudentWhere(instructorSession, { includeInactiveAccounts: false }),
        select: interventionQueueStudentSelect(now),
      },
    },
    {
      name: "dashboard_bundle_certifications",
      model: "certification",
      // Mirrors assembleStudentContextBundle's certification read
      // (src/lib/sage/context-bundle.ts) — the most join-heavy of its nine
      // parallel reads (nested requirements -> template).
      args: {
        where: { studentId: bench.studentId },
        select: {
          certType: true,
          status: true,
          startedAt: true,
          completedAt: true,
          requirements: {
            select: {
              completed: true,
              completedAt: true,
              verifiedAt: true,
              template: { select: { required: true } },
            },
          },
        },
      },
    },
    {
      name: "dashboard_bundle_progression_events",
      model: "progressionEvent",
      // Mirrors the same bundle's progressionEvent read — time-windowed and
      // append-only, the shape most likely to grow into a real "large
      // table" seq-scan hazard as a program runs for years.
      args: {
        where: {
          studentId: bench.studentId,
          occurredAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
        },
        select: { eventType: true, sourceType: true, xp: true, occurredAt: true },
        orderBy: { occurredAt: "desc" },
        take: 21,
      },
    },
    {
      name: "weekly_nudge_roster",
      model: "studentClassEnrollment",
      // Mirrors planWeeklyJobsNudges's roster query (src/lib/nudges/
      // schedule.ts) with both scopes "all" (scopedClassIds === null), the
      // program-wide case — the one most likely to touch every row.
      args: {
        where: {
          status: "active",
          ...(scopedClassIds !== null ? { classId: { in: scopedClassIds } } : {}),
          student: { role: "student", isActive: true },
        },
        orderBy: [{ studentId: "asc" }, { classId: "asc" }],
        select: { studentId: true, classId: true },
        take: 200 * 4,
      },
    },
    {
      name: "funnel_report",
      model: "connection",
      // Mirrors fetchConnectFunnel's connection read (src/lib/connect/
      // funnel.ts), program-wide (no classId/employerId filter), unbounded
      // date range — the broadest shape that route accepts.
      args: {
        where: {
          studentId: { in: studentIds.length > 0 ? studentIds : ["cbench-none"] },
          ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
        },
        select: {
          id: true,
          studentId: true,
          employerId: true,
          status: true,
          createdAt: true,
          sentAt: true,
          hiredAt: true,
          packet: true,
          employer: { select: { name: true } },
          jobLead: { select: { classId: true, class: { select: { name: true } } } },
        },
        take: MAX_CONNECT_REPORT_ROWS,
      },
    },
  ];
}

export async function run(ctx) {
  const databaseUrl = ctx.env?.databaseUrl;
  if (!databaseUrl) {
    // requires: ["postgres","cohort"] should have gated this already; this
    // is a defensive second check so a direct `run(ctx)` call from a test
    // never hits a real network call with an empty connection string.
    throw new Error("query-plans requires DATABASE_URL to be set.");
  }

  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log: [{ emit: "event", level: "query" }],
  });

  const captured = [];
  client.$on("query", (event) => captured.push({ query: event.query, params: event.params }));

  const cohortFixture = ctx.fixture ?? {};
  const bench = {
    instructorId: cohortFixture.instructorId ?? "cbenchinstr1",
    instructorLogin: cohortFixture.instructorLogin ?? "bench-instructor-1",
    studentId: cohortFixture.studentId ?? "cbenchstu01",
  };

  const plansCaptured = [];
  const perQueryDetails = [];
  const seqScanOffenders = new Map(); // relation -> Set(queryNames)

  try {
    await client.$executeRawUnsafe("ANALYZE;");

    const hotQueries = await buildHotQueries({ bench });

    for (const hot of hotQueries) {
      const before = captured.length;
      try {
        await client[hot.model].findMany(hot.args);
      } catch (error) {
        perQueryDetails.push({ name: hot.name, error: error?.message ?? String(error) });
        continue;
      }
      const emitted = captured.slice(before);
      for (const [index, entry] of emitted.entries()) {
        let plan;
        try {
          const params = JSON.parse(entry.params ?? "[]");
          const rows = await client.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) ${entry.query}`, ...params);
          plan = rows?.[0]?.["QUERY PLAN"]?.[0]?.Plan ?? null;
        } catch (error) {
          perQueryDetails.push({
            name: `${hot.name}#${index}`,
            error: `EXPLAIN failed: ${error?.message ?? String(error)}`,
          });
          continue;
        }
        if (!plan) continue;
        plansCaptured.push({ name: hot.name, plan });
        const seqScans = collectSeqScans(plan);
        for (const relation of seqScans) {
          if (!seqScanOffenders.has(relation)) seqScanOffenders.set(relation, new Set());
          seqScanOffenders.get(relation).add(hot.name);
        }
        perQueryDetails.push({
          name: `${hot.name}#${index}`,
          totalCost: planTotalCost(plan),
          seqScans,
        });
      }
    }

    // Only a relation ACTUALLY large in this database counts against the
    // floor — see the file header on why row-count, not table-name, gates
    // this on the small synthetic cohort.
    const largeTableViolations = [];
    if (seqScanOffenders.size > 0) {
      const relations = [...seqScanOffenders.keys()];
      const rows = await client.$queryRawUnsafe(
        `SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE relname = ANY($1::text[])`,
        relations,
      );
      const liveTuples = new Map(rows.map((r) => [r.relname, Number(r.n_live_tup)]));
      for (const [relation, queries] of seqScanOffenders) {
        const rowCount = liveTuples.get(relation) ?? 0;
        if (rowCount > LARGE_TABLE_ROW_THRESHOLD) {
          largeTableViolations.push({ table: relation, rowCount, queries: [...queries] });
        }
      }
    }

    const totalCosts = perQueryDetails
      .map((d) => d.totalCost)
      .filter((v) => typeof v === "number");
    const avgTotalCost = totalCosts.length > 0 ? totalCosts.reduce((a, b) => a + b, 0) / totalCosts.length : null;

    return {
      metrics: [
        {
          id: "seq_scans_on_large_tables",
          value: largeTableViolations.length,
          n: plansCaptured.length,
          details: { largeTableRowThreshold: LARGE_TABLE_ROW_THRESHOLD, violations: largeTableViolations },
        },
        {
          id: "plans_captured",
          value: plansCaptured.length,
          details: { hotQueryCount: (await buildHotQueries({ bench })).length, perQuery: perQueryDetails },
        },
        {
          id: "avg_estimated_cost",
          value: avgTotalCost === null ? 0 : Number(avgTotalCost.toFixed(2)),
          n: totalCosts.length,
          details: { perQuery: perQueryDetails.map((d) => ({ name: d.name, totalCost: d.totalCost ?? null })) },
        },
      ],
    };
  } finally {
    await client.$disconnect();
  }
}

await selfTest(import.meta.url, run);
