import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PACKET_FIELDS,
  PACKET_FIELD_KEYS,
  PACKET_FIELD_LABELS,
  SUBSIDY_FALLBACK_LINE,
  candidateDisplayName,
  packetFieldList,
  packetSchema,
  type Packet,
} from "./packet-shared";

function packet(overrides: Partial<Packet> = {}): Packet {
  return packetSchema.parse({
    resumeVersionId: "clresume0000000000000000",
    coverLetterId: "clcover00000000000000000",
    resumeFileUploadId: null,
    endorsement: "Dana finished every class on time and earned the forklift card in May.",
    includedCertIds: ["clcert000000000000000000"],
    includedFields: [...PACKET_FIELD_KEYS],
    candidateName: "Dana R.",
    certifications: ["Forklift Operator"],
    availabilitySummary: "Weekdays, mornings and afternoons",
    earliestStart: "2026-09-15",
    subsidyLine: null,
    ...overrides,
  });
}

describe("the employer packet — what it may never contain", () => {
  // Same shape of guard as workforce-batch.test.ts, and for the same reason:
  // this is the payload that leaves the program. The design spec §12.1 names
  // what is NOT included by default; these are the real column names on
  // SpokesRecord, StudentWorkProfile and Student, so a later "just add the
  // county" shows up here by name.
  const FORBIDDEN = [
    "barriersOnEntry",
    "barriersRemaining",
    "householdType",
    "county",
    "homeZip",
    "birthDate",
    "race",
    "ethnicity",
    "gender",
    "TANF",
    "SNAP",
    "benefit",
    "barrier",
    "caseNote",
    "mood",
    "payFloor",
    "childcare",
    "transport",
    "maxCommute",
    "studentId",
    "score",
    "readiness",
    "phone",
    "address",
  ];

  it("has a fixed field list with nothing about benefits, barriers, scores or demographics", () => {
    const surface = [...PACKET_FIELD_KEYS, ...Object.values(PACKET_FIELD_LABELS)]
      .join(" ")
      .toLowerCase();
    for (const field of FORBIDDEN) {
      assert.ok(
        !surface.includes(field.toLowerCase()),
        `"${field}" must never be a packet field`,
      );
    }
  });

  it("is exactly the seven approved fields, in order", () => {
    assert.deepEqual(
      [...PACKET_FIELD_KEYS],
      [
        "candidate_name",
        "resume",
        "verified_certifications",
        "availability",
        "earliest_start",
        "endorsement",
        "subsidy_line",
      ],
    );
    assert.equal(PACKET_FIELDS.length, PACKET_FIELD_KEYS.length);
  });

  it("gives every field a grade-6 label the student is shown before approving", () => {
    for (const key of PACKET_FIELD_KEYS) {
      const label = PACKET_FIELD_LABELS[key];
      assert.equal(typeof label, "string");
      assert.ok(label.length > 0, `${key} has no label`);
    }
  });

  it("refuses a packet whose includedFields names anything outside the allowlist", () => {
    assert.throws(
      () => packet({ includedFields: ["candidate_name", "county" as never] }),
      /invalid|Invalid/,
    );
  });

  it("packetFieldList renders the student-visible list from includedFields only", () => {
    const list = packetFieldList(
      packet({ includedFields: ["candidate_name", "resume", "endorsement"] }),
    );
    assert.deepEqual(list, [
      PACKET_FIELD_LABELS.candidate_name,
      PACKET_FIELD_LABELS.resume,
      PACKET_FIELD_LABELS.endorsement,
    ]);
    assert.ok(!list.join(" ").toLowerCase().includes("pay"));
  });

  it("names the candidate as first name plus last initial, never in full", () => {
    assert.equal(candidateDisplayName("Dana Rivers"), "Dana R.");
    assert.equal(candidateDisplayName("Dana  Marie   Rivers"), "Dana R.");
    assert.equal(candidateDisplayName("Prince"), "Prince");
    assert.equal(candidateDisplayName("  "), "A SPOKES student");
    // A surname must never survive whole.
    assert.ok(!candidateDisplayName("Dana Rivers").includes("Rivers"));
  });

  it("carries the ask-them line when there is no verified subsidy figure", () => {
    assert.equal(packet({ subsidyLine: null }).subsidyLine, null);
    assert.match(SUBSIDY_FALLBACK_LINE, /hiring incentives/i);
    // The fallback names no dollar figure and no program: an unverified number
    // on an employer-facing page is the one thing P0.8 exists to prevent.
    assert.ok(!/\$|\d/.test(SUBSIDY_FALLBACK_LINE));
  });

  it("bounds the endorsement so a runaway draft cannot become the packet", () => {
    assert.throws(() => packet({ endorsement: "x".repeat(2001) }));
  });
});
