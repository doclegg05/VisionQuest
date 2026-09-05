#!/usr/bin/env node
// =============================================================================
// report-parity — three reports, one population, one answer.
//
// "How many SPOKES students got a job" is computed three times in this codebase
// by three modules that share no code:
//
//   computeGrantKpis      → the state grant KPI report;
//   buildDohsExportRows   → the DoHS CSV the FY27 review reads;
//   computeFunnel         → the instructor's Connect funnel.
//
// They must agree. When they do not, somebody is going to send one of these
// numbers to a funder — and nothing in the product would have said which one
// was wrong, because each is internally consistent.
//
//   parity_violations — pairs of reports that disagree.  exactly 0
//   plus each of the three counts on its own, so a failure names the report
//   that moved instead of only reporting that one did.
//
// The funnel count is CUMULATIVE from `hired`, and that is not a detail: the
// funnel's stage counts are mutually exclusive buckets holding each
// connection's furthest stage, so a student now at `retained_60` is not in the
// `hired` bucket. Reading `hired` alone reports 2 for a cohort where 6 people
// have jobs — a wrong answer that looks entirely reasonable.
//
//   node scripts/bench/suites/report-parity.mjs --self-test
// =============================================================================

import { loadCohort } from "../lib/cohort.mjs";
import { isSelfTest, selfTest } from "../lib/self-test.mjs";

const SUITE = "report-parity";

export async function run(ctx) {
  const { computeGrantKpis } = await import("../../../src/lib/grant-kpi.ts");
  const { buildDohsExportRows } = await import(
    "../../../src/lib/connect/dohs-export-shared.ts"
  );
  const { computeFunnel, FUNNEL_STAGE_ORDER } = await import(
    "../../../src/lib/connect/funnel-shared.ts"
  );

  const cohort = loadCohort();
  const now = new Date(cohort.meta.epoch);

  // --- 1. Grant KPI ---------------------------------------------------
  const grantRecords = cohort.spokesRecords.map((record) => ({
    id: record.id,
    status: record.status,
    referralDate: record.referralDate ? new Date(record.referralDate) : null,
    enrolledAt: record.enrolledAt ? new Date(record.enrolledAt) : null,
    unsubsidizedEmploymentAt: record.unsubsidizedEmploymentAt
      ? new Date(record.unsubsidizedEmploymentAt)
      : null,
    hourlyWage: record.hourlyWage,
    postSecondaryEnteredAt: record.postSecondaryEnteredAt
      ? new Date(record.postSecondaryEnteredAt)
      : null,
    employmentFollowUps: record.employmentFollowUps.map((followUp) => ({
      checkpointMonths: followUp.checkpointMonths,
      status: followUp.status,
    })),
  }));
  const kpis = computeGrantKpis(grantRecords, now);

  // --- 2. DoHS export -------------------------------------------------
  const applicationById = new Map(cohort.applications.map((row) => [row.id, row]));
  const connectionByApplicationId = new Map(
    cohort.applications
      .filter((row) => row.connectionId)
      .map((row) => [row.id, cohort.connectionById.get(row.connectionId)]),
  );

  const dohsRows = buildDohsExportRows(
    cohort.spokesRecords.map((record) => {
      const application = record.placementApplicationId
        ? (applicationById.get(record.placementApplicationId) ?? null)
        : null;
      const connection = record.placementApplicationId
        ? (connectionByApplicationId.get(record.placementApplicationId) ?? null)
        : null;

      return {
        spokesId: cohort.studentById.get(record.studentId)?.spokesId ?? null,
        className: record.className,
        enrollmentDate: record.enrolledAt,
        exitDate: record.exitDate,
        unsubsidizedEmploymentAt: record.unsubsidizedEmploymentAt,
        employerName: record.employerName,
        hourlyWage: record.hourlyWage,
        placementApplication: application
          ? {
              verificationStatus: application.verificationStatus,
              connection: connection
                ? {
                    packet: connection.packet,
                    jobLeadSchedule: cohort.leadById.get(connection.jobLeadId)?.schedule ?? null,
                    eventToStatuses: connection.events.map((event) => event.toStatus),
                  }
                : null,
            }
          : null,
        employmentFollowUps: record.employmentFollowUps,
      };
    }),
  );

  // --- 3. Connect funnel ----------------------------------------------
  const funnel = computeFunnel(
    cohort.connections.map((connection) => ({
      id: connection.id,
      studentId: connection.studentId,
      employerId: connection.employerId,
      employerName: connection.employerName,
      classId: connection.classId,
      className: connection.className,
      status: connection.status,
      createdAt: connection.createdAt,
      sentAt: connection.sentAt,
      hiredAt: connection.hiredAt,
      packet: connection.packet,
    })),
    cohort.connections.flatMap((connection) =>
      connection.events.map((event) => ({
        connectionId: connection.id,
        toStatus: event.toStatus,
        at: event.at,
      })),
    ),
    {
      selfDirectedApplications: cohort.applications
        .filter((application) => application.selfDirected)
        .map((application) => ({
          id: application.id,
          studentId: application.studentId,
          createdAt: application.createdAt,
          status: application.status,
          verificationStatus: application.verificationStatus,
        })),
    },
  );

  const hiredIndex = FUNNEL_STAGE_ORDER.indexOf("hired");
  const funnelHired = funnel.stages
    .filter((stage) => FUNNEL_STAGE_ORDER.indexOf(stage.status) >= hiredIndex)
    .reduce((total, stage) => total + stage.count, 0);

  // --- parity ----------------------------------------------------------
  const counts = {
    grant_kpi_placements: kpis.counts.placed,
    dohs_export_placed_rows: dohsRows.filter((row) => row.placed).length,
    funnel_hired_or_beyond: funnelHired,
  };

  const violations = [];
  const entries = Object.entries(counts);
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (entries[i][1] !== entries[j][1]) {
        violations.push({
          a: entries[i][0],
          aValue: entries[i][1],
          b: entries[j][0],
          bValue: entries[j][1],
        });
      }
    }
  }

  // The fixture states what the cohort holds. A run where all three agreed on
  // ZERO would report perfect parity over a population with no placements at
  // all — technically true and completely uninformative — so a count that has
  // drifted from the fixture is a violation in its own right.
  if (
    ctx.fixture.expectPlacements !== undefined &&
    counts.grant_kpi_placements !== ctx.fixture.expectPlacements
  ) {
    violations.push({
      a: "fixture.expectPlacements",
      aValue: ctx.fixture.expectPlacements,
      b: "grant_kpi_placements",
      bValue: counts.grant_kpi_placements,
    });
  }

  return {
    metrics: [
      {
        id: "parity_violations",
        value: violations.length,
        n: entries.length,
        details: {
          violations,
          counts,
          // Reported because it is the thing that would make the three
          // legitimately disagree if the fixture ever changed: a self-directed
          // application that is accepted AND verified is a placement the
          // funnel's stage counts never see.
          selfDirectedAcceptedVerified: funnel.comparison.selfDirectedAcceptedVerified,
          selfDirectedApplications: funnel.comparison.selfDirectedApplications,
          connectSourced: dohsRows.filter((row) => row.placementSource === "connect").length,
        },
      },
      { id: "grant_kpi_placements", value: counts.grant_kpi_placements, n: cohort.spokesRecords.length },
      { id: "dohs_export_placed_rows", value: counts.dohs_export_placed_rows, n: dohsRows.length },
      { id: "funnel_hired_or_beyond", value: counts.funnel_hired_or_beyond, n: cohort.connections.length },
    ],
  };
}

if (isSelfTest(import.meta.url)) await selfTest(SUITE, run);
