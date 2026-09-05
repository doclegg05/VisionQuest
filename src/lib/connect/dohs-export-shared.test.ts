import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeGrantKpis, type GrantKpiRecord } from "@/lib/grant-kpi";

import {
  DOHS_EXPORT_COLUMNS,
  buildDohsExportCsv,
  buildDohsExportRow,
  buildDohsExportRows,
  dohsExportFilename,
  type DohsEmploymentFollowUpRow,
  type DohsSourceRow,
} from "./dohs-export-shared";

function source(overrides: Partial<DohsSourceRow> = {}): DohsSourceRow {
  return {
    spokesId: "SP-1001",
    className: "SPOKES Fall 2026",
    enrollmentDate: "2026-01-05",
    exitDate: null,
    unsubsidizedEmploymentAt: null,
    employerName: null,
    hourlyWage: null,
    placementApplication: null,
    employmentFollowUps: [],
    ...overrides,
  };
}

function followUp(overrides: Partial<DohsEmploymentFollowUpRow> = {}): DohsEmploymentFollowUpRow {
  return {
    checkpointMonths: 3,
    status: "employed",
    checkedAt: "2026-09-01",
    ...overrides,
  };
}

describe("DOHS_EXPORT_COLUMNS", () => {
  it("has no PII column outside the allowlist", () => {
    // Mirrors workforce-batch.test.ts's denylist: this file leaves the
    // program, so names, contact info, and demographics must never appear.
    const FORBIDDEN = [
      "name",
      "email",
      "phone",
      "address",
      "ssn",
      "birthdate",
      "race",
      "ethnicity",
      "gender",
      "county",
      "household",
      "barrier",
    ];
    const header = DOHS_EXPORT_COLUMNS.join(" ").toLowerCase();
    for (const field of FORBIDDEN) {
      // "Employer name" and "Class" are allowed — check word boundaries so
      // "name" as a column-name SUBSTRING (Employer name) doesn't false-flag,
      // while still catching a bare "Student name" style column if one were
      // ever added.
      const asColumn = DOHS_EXPORT_COLUMNS.some(
        (col) => col.toLowerCase() === field || col.toLowerCase() === `student ${field}`,
      );
      assert.ok(!asColumn, `"${field}" must never be its own column in the DoHS export`);
    }
    assert.ok(header.length > 0);
  });

  it("does not include the SPOKES record's name, email, or address fields", () => {
    const FORBIDDEN_SPOKES_FIELDS = [
      "firstName",
      "lastName",
      "referralEmail",
      "birthDate",
      "race",
      "ethnicity",
      "gender",
      "householdType",
      "barriersOnEntry",
      "barriersRemaining",
      "notes",
    ];
    const header = DOHS_EXPORT_COLUMNS.join(" ").toLowerCase();
    for (const field of FORBIDDEN_SPOKES_FIELDS) {
      assert.ok(!header.includes(field.toLowerCase()), `"${field}" leaked into DOHS_EXPORT_COLUMNS`);
    }
  });
});

describe("buildDohsExportRow", () => {
  it("marks placed = true iff unsubsidizedEmploymentAt is set", () => {
    assert.equal(buildDohsExportRow(source()).placed, false);
    assert.equal(
      buildDohsExportRow(source({ unsubsidizedEmploymentAt: "2026-06-01" })).placed,
      true,
    );
  });

  it("start date mirrors unsubsidizedEmploymentAt's UTC calendar date", () => {
    const row = buildDohsExportRow(source({ unsubsidizedEmploymentAt: "2026-06-01T14:00:00Z" }));
    assert.equal(row.startDate, "2026-06-01");
  });

  it("row date columns are NOT shifted through Eastern Time — they are @db.Date calendar dates, not real instants", () => {
    // unsubsidizedEmploymentAt/enrolledAt/exitDate/checkedAt are all Prisma
    // `@db.Date` columns: Postgres stores no time-of-day for them, so Prisma
    // always returns them as UTC midnight for that calendar date. Running
    // THIS kind of value through an Eastern Time conversion (as the
    // dohsExportFilename `today` argument correctly does, because THAT one
    // really is "the instant this report ran") would shift EVERY row back
    // one calendar day, always, with no exception — 2026-09-01 UTC midnight
    // is 2026-08-31 8pm EDT. This test is the regression guard for exactly
    // that mistake: a bare date-only value must round-trip unchanged.
    const row = buildDohsExportRow(source({ unsubsidizedEmploymentAt: "2026-09-01" }));
    assert.equal(row.startDate, "2026-09-01");
  });

  it("placementSource is null when there is no linked application at all", () => {
    const row = buildDohsExportRow(
      source({ unsubsidizedEmploymentAt: "2026-06-01", employerName: "Manual Co" }),
    );
    assert.equal(row.placementSource, null);
  });

  it("placementSource is self_directed when the application has no connection", () => {
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        placementApplication: { verificationStatus: "verified", connection: null },
      }),
    );
    assert.equal(row.placementSource, "self_directed");
    assert.equal(row.subsidyType, null);
  });

  it("placementSource is connect when the application has a connection", () => {
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        placementApplication: {
          verificationStatus: "verified",
          connection: { packet: null, jobLeadSchedule: null, eventToStatuses: ["proposed", "sent", "hired"] },
        },
      }),
    );
    assert.equal(row.placementSource, "connect");
  });

  it("extracts the subsidy PROGRAM NAME from packet.subsidyLine, not the full sentence", () => {
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        placementApplication: {
          verificationStatus: "verified",
          connection: {
            eventToStatuses: ["hired"],
            packet: {
              resumeVersionId: null,
              coverLetterId: null,
              resumeFileUploadId: null,
              endorsement: "",
              includedCertIds: [],
              includedFields: ["candidate_name"],
              candidateName: "Dana R.",
              certifications: [],
              availabilitySummary: "",
              earliestStart: null,
              subsidyLine:
                "WV Works Employment Incentive Program (EIP): Half of the starting wage, for 200 to 600 hours. Check with the local WV Works office for the current rules.",
            },
            jobLeadSchedule: null,
          },
        },
      }),
    );
    assert.equal(row.subsidyType, "WV Works Employment Incentive Program (EIP)");
  });

  it("subsidyType is null when the packet carries no subsidy line", () => {
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        placementApplication: {
          verificationStatus: "verified",
          connection: {
            eventToStatuses: ["hired"],
            packet: {
              resumeVersionId: null,
              coverLetterId: null,
              resumeFileUploadId: null,
              endorsement: "",
              includedCertIds: [],
              includedFields: ["candidate_name"],
              candidateName: "Dana R.",
              certifications: [],
              availabilitySummary: "",
              earliestStart: null,
              subsidyLine: null,
            },
            jobLeadSchedule: null,
          },
        },
      }),
    );
    assert.equal(row.subsidyType, null);
  });

  it("hoursPerWeek reads the connect JobLead schedule, preferring the max", () => {
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        placementApplication: {
          verificationStatus: "verified",
          connection: {
            eventToStatuses: ["hired"],
            packet: null,
            jobLeadSchedule: { hoursPerWeekMin: 20, hoursPerWeekMax: 30 },
          },
        },
      }),
    );
    assert.equal(row.hoursPerWeek, 30);
  });

  it("hoursPerWeek is null for a self-directed placement (no JobLead exists)", () => {
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        placementApplication: { verificationStatus: "verified", connection: null },
      }),
    );
    assert.equal(row.hoursPerWeek, null);
  });
});

describe("buildDohsExportRow — retention (C1)", () => {
  it("PRIMARY: derives retained30/60/90 from an employed 3-month SpokesEmploymentFollowUp, days-since-start", () => {
    // Employment started 2026-06-01; the 3-month follow-up landed 2026-09-01
    // (92 days later) — past 30, 60, AND 90.
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        employmentFollowUps: [followUp({ checkpointMonths: 3, status: "employed", checkedAt: "2026-09-01" })],
      }),
    );
    assert.equal(row.retained30, true);
    assert.equal(row.retained60, true);
    assert.equal(row.retained90, true);
  });

  it("a follow-up landing between 30 and 60 days out satisfies ONLY retained30", () => {
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        employmentFollowUps: [followUp({ status: "employed", checkedAt: "2026-07-01" })],
      }),
    );
    // 2026-06-01 -> 2026-07-01 = 30 days exactly.
    assert.equal(row.retained30, true);
    assert.equal(row.retained60, false);
    assert.equal(row.retained90, false);
  });

  it("a NOT-employed follow-up (status !== 'employed') proves nothing", () => {
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        employmentFollowUps: [followUp({ status: "unreachable", checkedAt: "2026-09-01" })],
      }),
    );
    assert.equal(row.retained30, false);
    assert.equal(row.retained60, false);
    assert.equal(row.retained90, false);
  });

  it("FALLBACK: a self-directed placement with NO follow-up but a Connection event history derives from that history", () => {
    // Self-directed placements normally have no Connection at all, but this
    // proves the fallback branch itself: given a connection and zero
    // follow-ups, retention comes from event history.
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        employmentFollowUps: [],
        placementApplication: {
          verificationStatus: "verified",
          connection: {
            eventToStatuses: ["proposed", "sent", "hired", "started", "retained_30"],
            packet: null,
            jobLeadSchedule: null,
          },
        },
      }),
    );
    assert.equal(row.retained30, true);
    assert.equal(row.retained60, false);
  });

  it("a REAL self-directed placement (no Connection, no follow-up) reports all three false — not silently 'No' by construction", () => {
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        employmentFollowUps: [],
        placementApplication: { verificationStatus: "verified", connection: null },
      }),
    );
    assert.equal(row.retained30, false);
    assert.equal(row.retained60, false);
    assert.equal(row.retained90, false);
  });

  it("a self-directed placement WITH an employed follow-up now correctly reports retained — the bug this replaces reported 'No' unconditionally", () => {
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        employmentFollowUps: [followUp({ status: "employed", checkedAt: "2026-09-01" })],
        placementApplication: { verificationStatus: "verified", connection: null },
      }),
    );
    assert.equal(row.retained30, true);
    assert.equal(row.retained60, true);
    assert.equal(row.retained90, true);
  });

  it("a connection that reached retained_60 and was LATER CLOSED still reports retained30/60 true (event history, not current status)", () => {
    // This is the exact C1 bug: the connection's CURRENT state is "closed"
    // (simulated here by the event history actually ending in a "closed"
    // event after "retained_60" — not by skipping straight to asserting on
    // a bare status string, which is what the pre-fix version of this test
    // did without ever exercising a real close).
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        employmentFollowUps: [],
        placementApplication: {
          verificationStatus: "verified",
          connection: {
            eventToStatuses: [
              "proposed",
              "student_approved",
              "sent",
              "interested",
              "hired",
              "started",
              "retained_30",
              "retained_60",
              "closed", // <- the connection WITHDREW/CLOSED after reaching retained_60
            ],
            packet: null,
            jobLeadSchedule: null,
          },
        },
      }),
    );
    assert.equal(row.retained30, true);
    assert.equal(row.retained60, true);
    assert.equal(row.retained90, false);
  });

  it("PRIMARY source wins over the FALLBACK when both exist (a follow-up says less than the event history claims)", () => {
    // Employment start 2026-06-01, follow-up only 10 days out (not
    // "retained" by the primary rule) even though the connection's event
    // history claims retained_90 — the follow-up is the source of truth
    // whenever one exists at all.
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        employmentFollowUps: [followUp({ status: "employed", checkedAt: "2026-06-11" })],
        placementApplication: {
          verificationStatus: "verified",
          connection: {
            eventToStatuses: ["hired", "started", "retained_30", "retained_60", "retained_90"],
            packet: null,
            jobLeadSchedule: null,
          },
        },
      }),
    );
    assert.equal(row.retained30, false);
    assert.equal(row.retained60, false);
    assert.equal(row.retained90, false);
  });

  it("the latest follow-up date (any status) fills the Follow-up date column", () => {
    const row = buildDohsExportRow(
      source({
        employmentFollowUps: [
          followUp({ checkpointMonths: 3, status: "employed", checkedAt: "2026-06-01" }),
          followUp({ checkpointMonths: 6, status: "unreachable", checkedAt: "2026-09-01" }),
        ],
      }),
    );
    assert.equal(row.followUpDate, "2026-09-01");
  });
});

describe("buildDohsExportCsv", () => {
  it("emits exactly DOHS_EXPORT_COLUMNS, in order, as the header", () => {
    const [header] = buildDohsExportCsv([]).split("\r\n");
    assert.equal(header, DOHS_EXPORT_COLUMNS.join(","));
  });

  it("escapes every cell — probes a formula-injection value in employerName", () => {
    const rows = buildDohsExportRows([
      source({ employerName: "=cmd|'/c calc'!A1", unsubsidizedEmploymentAt: "2026-06-01" }),
    ]);
    const csv = buildDohsExportCsv(rows);
    const dataLine = csv.split("\r\n")[1];
    // escapeCsvValue neutralizes a formula trigger by PREPENDING a quote —
    // the cell must start with "'=", not a bare "=" that a spreadsheet would
    // execute as a formula.
    assert.ok(dataLine.includes(",'=cmd"), `expected the neutralized formula cell, got: ${dataLine}`);
    assert.ok(!dataLine.includes(",=cmd"), "a bare '=' formula trigger reached the CSV unescaped");
  });

  it("escapes a comma inside a class name with RFC 4180 quoting", () => {
    const rows = buildDohsExportRows([source({ className: "Fall, 2026 Cohort" })]);
    const csv = buildDohsExportCsv(rows);
    const dataLine = csv.split("\r\n")[1];
    assert.ok(dataLine.includes('"Fall, 2026 Cohort"'));
  });

  it("renders booleans as Yes/No and nulls as empty cells", () => {
    const rows = buildDohsExportRows([source()]);
    const csv = buildDohsExportCsv(rows);
    const [, dataLine] = csv.split("\r\n");
    const cells = dataLine.split(",");
    // Placed (index 4) is false -> "No"
    assert.equal(cells[4], "No");
    // Exit date (index 3) is null -> empty
    assert.equal(cells[3], "");
  });
});

describe("dohsExportFilename", () => {
  it("names the file by its ET calendar date", () => {
    assert.equal(dohsExportFilename(new Date("2026-09-05T12:00:00Z")), "dohs-spokes-report-2026-09-05.csv");
  });

  it("uses the ET calendar day, not UTC, for a late-evening instant", () => {
    // 2026-09-06T01:00:00Z = 2026-09-05 9:00pm EDT.
    assert.equal(dohsExportFilename(new Date("2026-09-06T01:00:00.000Z")), "dohs-spokes-report-2026-09-05.csv");
  });
});

describe("acceptance: grant KPI placements and the DoHS export agree", () => {
  it("counts the same placements from the same fixture", () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const grantKpiRecords: GrantKpiRecord[] = [
      {
        id: "r1",
        status: "enrolled",
        referralDate: new Date("2025-08-01"),
        enrolledAt: new Date("2025-08-15"),
        unsubsidizedEmploymentAt: new Date("2026-01-10"),
        hourlyWage: 16,
        postSecondaryEnteredAt: null,
        employmentFollowUps: [],
      },
      {
        id: "r2",
        status: "enrolled",
        referralDate: new Date("2025-08-01"),
        enrolledAt: new Date("2025-08-20"),
        unsubsidizedEmploymentAt: null,
        hourlyWage: null,
        postSecondaryEnteredAt: null,
        employmentFollowUps: [],
      },
      {
        id: "r3",
        status: "enrolled",
        referralDate: new Date("2025-09-01"),
        enrolledAt: new Date("2025-09-10"),
        unsubsidizedEmploymentAt: new Date("2026-02-01"),
        hourlyWage: 18,
        postSecondaryEnteredAt: null,
        employmentFollowUps: [],
      },
    ];

    const dohsSources: DohsSourceRow[] = grantKpiRecords.map((record, index) => ({
      spokesId: `SP-${1000 + index}`,
      className: "SPOKES Fall 2026",
      enrollmentDate: record.enrolledAt,
      exitDate: null,
      unsubsidizedEmploymentAt: record.unsubsidizedEmploymentAt,
      employerName: record.unsubsidizedEmploymentAt ? "Mountain Metals" : null,
      hourlyWage: record.hourlyWage,
      placementApplication: record.unsubsidizedEmploymentAt
        ? { verificationStatus: "verified", connection: null }
        : null,
      employmentFollowUps: [],
    }));

    const grantKpiPayload = computeGrantKpis(grantKpiRecords, now);
    const dohsRows = buildDohsExportRows(dohsSources);

    assert.equal(
      grantKpiPayload.counts.placed,
      dohsRows.filter((row) => row.placed).length,
      "grant-kpi and the DoHS export must agree on how many placements happened",
    );
  });

  it("DISCORDANT ROW (C1 regression guard): a closed connection + an employed 3-month follow-up — retention must still show true", () => {
    // A placement whose Connection was later closed, but which grant-kpi's
    // OWN retention logic (SpokesEmploymentFollowUp, 3-month "employed")
    // would count as retained. Before the C1 fix, buildDohsExportRow read
    // Connection.status directly ("closed" — no funnel index), so this row
    // exported retained30/60/90 = false/false/false while grant-kpi's
    // threeMonthRetention counted the SAME record as retained. This test
    // fails on that pre-fix behavior and passes once the follow-up is read.
    const now = new Date("2026-10-01T00:00:00Z");
    const employmentStart = new Date("2026-06-01");
    const followUpDate = new Date("2026-09-01"); // ~92 days later — a real 3-month check-in

    const grantKpiRecord: GrantKpiRecord = {
      id: "discordant-1",
      status: "enrolled",
      referralDate: new Date("2025-08-01"),
      enrolledAt: new Date("2025-08-15"),
      unsubsidizedEmploymentAt: employmentStart,
      hourlyWage: 17,
      postSecondaryEnteredAt: null,
      employmentFollowUps: [{ checkpointMonths: 3, status: "employed" }],
    };
    const grantKpiPayload = computeGrantKpis([grantKpiRecord], now);
    assert.equal(grantKpiPayload.metrics.threeMonthRetention.numerator, 1);

    const dohsRow = buildDohsExportRow(
      source({
        spokesId: "SP-DISCORD",
        unsubsidizedEmploymentAt: employmentStart,
        employmentFollowUps: [followUp({ checkpointMonths: 3, status: "employed", checkedAt: followUpDate })],
        placementApplication: {
          verificationStatus: "verified",
          connection: {
            eventToStatuses: ["proposed", "sent", "interested", "hired", "closed"],
            packet: null,
            jobLeadSchedule: null,
          },
        },
      }),
    );

    assert.equal(dohsRow.placed, true);
    assert.equal(
      dohsRow.retained30,
      true,
      "grant-kpi counts this record as 3-month-retained; the DoHS export must agree, not read the closed Connection status",
    );
    assert.equal(dohsRow.retained60, true);
    assert.equal(dohsRow.retained90, true);
  });
});
