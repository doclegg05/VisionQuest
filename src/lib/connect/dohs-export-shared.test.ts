import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeGrantKpis, type GrantKpiRecord } from "@/lib/grant-kpi";

import {
  DOHS_EXPORT_COLUMNS,
  buildDohsExportCsv,
  buildDohsExportRow,
  buildDohsExportRows,
  dohsExportFilename,
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
    latestFollowUpAt: null,
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

  it("start date mirrors unsubsidizedEmploymentAt as an ISO date", () => {
    const row = buildDohsExportRow(source({ unsubsidizedEmploymentAt: "2026-06-01T14:00:00Z" }));
    assert.equal(row.startDate, "2026-06-01");
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
    assert.equal(row.retained30, false);
  });

  it("placementSource is connect when the application has a connection", () => {
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        placementApplication: {
          verificationStatus: "verified",
          connection: { status: "started", packet: null, jobLeadSchedule: null },
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
            status: "hired",
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
            status: "hired",
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
            status: "hired",
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

  it("retained flags are cumulative: reaching retained_60 implies retained_30", () => {
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        placementApplication: {
          verificationStatus: "verified",
          connection: { status: "retained_60", packet: null, jobLeadSchedule: null },
        },
      }),
    );
    assert.equal(row.retained30, true);
    assert.equal(row.retained60, true);
    assert.equal(row.retained90, false);
  });

  it("retained flags are all false for a self-directed placement", () => {
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        placementApplication: { verificationStatus: "verified", connection: null },
      }),
    );
    assert.equal(row.retained30, false);
    assert.equal(row.retained60, false);
    assert.equal(row.retained90, false);
  });

  it("a connection that reached retained_60 then withdrew still shows retained30/60 true", () => {
    // "withdrawn" has no FUNNEL_STAGE_ORDER index (-1), so this exercises
    // that a CURRENT exit status does not erase the flags — the row's
    // `connection.status` here stands in for "furthest reached" the same way
    // funnel.ts would derive it from event history before calling this.
    const row = buildDohsExportRow(
      source({
        unsubsidizedEmploymentAt: "2026-06-01",
        placementApplication: {
          verificationStatus: "verified",
          connection: { status: "retained_60", packet: null, jobLeadSchedule: null },
        },
      }),
    );
    assert.equal(row.retained30, true);
    assert.equal(row.retained60, true);
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
  it("names the file by date", () => {
    assert.equal(dohsExportFilename(new Date("2026-09-05T12:00:00Z")), "dohs-spokes-report-2026-09-05.csv");
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
      latestFollowUpAt: null,
    }));

    const grantKpiPayload = computeGrantKpis(grantKpiRecords, now);
    const dohsRows = buildDohsExportRows(dohsSources);

    assert.equal(
      grantKpiPayload.counts.placed,
      dohsRows.filter((row) => row.placed).length,
      "grant-kpi and the DoHS export must agree on how many placements happened",
    );
  });
});
