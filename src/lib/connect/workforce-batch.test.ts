import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALLOWED_COLUMNS,
  READY_TO_WORK_SCORE,
  batchFilename,
  buildWorkforceBatchCsv,
  type BatchRow,
} from "./workforce-batch";

function row(overrides: Partial<BatchRow> = {}): BatchRow {
  return {
    displayName: "Dana Rivers",
    className: "SPOKES Fall 2026",
    readinessScore: 82,
    earliestStart: "2026-09-15",
    availableCells: 14,
    transport: "bus",
    verifiedCertifications: ["Ready to Work"],
    ...overrides,
  };
}

describe("buildWorkforceBatchCsv — what it must not contain", () => {
  // This file leaves the program. The design spec's guardrail is explicit:
  // "no benefits status, no narrative about barriers". These names are the
  // real column names on SpokesRecord, so if anyone ever widens the export by
  // spreading a record into a row, this test names the field that leaked.
  const FORBIDDEN = [
    "barriersOnEntry",
    "barriersRemaining",
    "householdType",
    "county",
    "birthDate",
    "race",
    "ethnicity",
    "gender",
    "referralEmail",
    "requiredParticipationHours",
    "notes",
    "TANF",
    "SNAP",
    "benefit",
    "barrier",
  ];

  it("has a fixed column list with nothing about benefits, barriers or demographics", () => {
    const header = ALLOWED_COLUMNS.join(" ").toLowerCase();
    for (const field of FORBIDDEN) {
      assert.ok(
        !header.includes(field.toLowerCase()),
        `"${field}" must never be a column in the WorkForce WV batch`,
      );
    }
  });

  it("emits exactly the allowed columns, in order", () => {
    const [header] = buildWorkforceBatchCsv([]).split("\r\n");
    assert.equal(header, ALLOWED_COLUMNS.join(","));
  });

  it("writes no row body for an empty week", () => {
    assert.equal(buildWorkforceBatchCsv([]), `${ALLOWED_COLUMNS.join(",")}\r\n`);
  });
});

describe("buildWorkforceBatchCsv — content", () => {
  it("labels readiness at or above the threshold as ready", () => {
    const csv = buildWorkforceBatchCsv([
      row({ readinessScore: READY_TO_WORK_SCORE }),
      row({ displayName: "Sam Ford", readinessScore: READY_TO_WORK_SCORE - 1 }),
    ]);
    const [, first, second] = csv.trim().split("\r\n");
    assert.ok(first.includes(",Yes,"), first);
    assert.ok(second.includes(",Not yet,"), second);
  });

  it("says 'Not set' rather than leaving a blank an outside reader would misread", () => {
    const csv = buildWorkforceBatchCsv([
      row({ earliestStart: null, transport: null, availableCells: 0, verifiedCertifications: [] }),
    ]);
    assert.ok(csv.includes("None yet"), csv);
    assert.equal((csv.match(/Not set/gu) ?? []).length, 3, csv);
  });

  it("joins several certifications into one cell without breaking the row", () => {
    const csv = buildWorkforceBatchCsv([
      row({ verifiedCertifications: ["Ready to Work", "Forklift Operator"] }),
    ]);
    assert.equal(csv.trim().split("\r\n").length, 2, "still one header and one row");
    assert.ok(csv.includes("Ready to Work; Forklift Operator"), csv);
  });
});

describe("buildWorkforceBatchCsv — escaping", () => {
  it("neutralizes a formula-injection name (this file is opened in Excel)", () => {
    const csv = buildWorkforceBatchCsv([row({ displayName: "=HYPERLINK(\"http://evil\",\"x\")" })]);
    assert.ok(csv.includes("'=HYPERLINK"), csv);
  });

  it("quotes a name containing a comma so the row keeps its shape", () => {
    const csv = buildWorkforceBatchCsv([row({ displayName: "Rivers, Dana" })]);
    assert.ok(csv.includes('"Rivers, Dana"'), csv);
    assert.equal(csv.trim().split("\r\n").length, 2);
  });

  it("escapes an embedded quote rather than ending the field early", () => {
    const csv = buildWorkforceBatchCsv([row({ className: 'SPOKES "Fall" 2026' })]);
    assert.ok(csv.includes('"SPOKES ""Fall"" 2026"'), csv);
  });
});

describe("batchFilename", () => {
  it("names the file by the day it was generated", () => {
    assert.equal(
      batchFilename(new Date("2026-09-05T13:00:00.000Z")),
      "connect-workforce-wv-2026-09-05.csv",
    );
  });
});
