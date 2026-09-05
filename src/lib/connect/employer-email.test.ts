// =============================================================================
// The email that carries a student's information out of the program.
//
// It is the one artefact here nobody can re-render: a page can be fixed and
// reloaded, a sent email cannot. So two properties are pinned — it speaks to
// the EMPLOYER, and it contains only what the student approved.
// =============================================================================

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildEmployerEmail } from "./employer-email";
import {
  EMPLOYER_FIELD_LABELS,
  PACKET_FIELD_LABELS,
  SUBSIDY_FALLBACK_LINE,
  type Packet,
  type PacketFieldKey,
} from "./packet-shared";

function packet(includedFields: PacketFieldKey[], overrides: Partial<Packet> = {}): Packet {
  return {
    resumeVersionId: "rv1",
    coverLetterId: "cl1",
    resumeFileUploadId: "file1",
    endorsement: "Dana came to every class.",
    includedCertIds: ["cert1"],
    candidateName: "Dana R.",
    certifications: ["Forklift Operator"],
    availabilitySummary: "Weekdays: mornings",
    earliestStart: "2026-10-01",
    subsidyLine: null,
    includedFields,
    ...overrides,
  };
}

function build(p: Packet) {
  return buildEmployerEmail({
    packet: p,
    contactName: "Pat Buyer",
    jobTitle: "Production Associate",
    employerName: "Mountain Metal",
    instructorName: "Ms. Legg",
    programEmail: "spokes@example.test",
    programName: "SPOKES",
    responseUrl: "https://visionquest.example.test/connect/tokentokentoken",
  });
}

const ALL_FIELDS: PacketFieldKey[] = [
  "candidate_name",
  "resume",
  "verified_certifications",
  "availability",
  "earliest_start",
  "endorsement",
  "subsidy_line",
];

describe("buildEmployerEmail", () => {
  it("speaks to the EMPLOYER — no student-voice label reaches the body", () => {
    // The bug: the shared list was rendered with the consent-screen labels,
    // which are written to the student ("Your résumé", "The cards you
    // earned"). Under a line reading "They agreed to share:", an employer
    // reads that as a list of their own things.
    const { text } = build(packet(ALL_FIELDS));

    assert.ok(
      !/^- Your /m.test(text),
      `a student-voice label reached the employer's inbox:\n${text}`,
    );
    for (const key of ALL_FIELDS) {
      assert.ok(
        text.includes(`- ${EMPLOYER_FIELD_LABELS[key]}`),
        `the email dropped "${key}"`,
      );
    }
  });

  it("uses the employer map for every key, with no student label left over", () => {
    // Belt and braces on the map itself: no rendered line may match a
    // PACKET_FIELD_LABELS value, or one key is still going through the wrong
    // vocabulary while the others were fixed.
    const { text } = build(packet(ALL_FIELDS));
    for (const [key, studentLabel] of Object.entries(PACKET_FIELD_LABELS) as [
      PacketFieldKey,
      string,
    ][]) {
      if (studentLabel === EMPLOYER_FIELD_LABELS[key]) continue;
      assert.ok(
        !text.includes(`- ${studentLabel}`),
        `"${key}" still renders its student label`,
      );
    }
  });

  it("lists ONLY the approved fields", () => {
    const { text } = build(packet(["candidate_name", "availability"]));

    assert.ok(text.includes(`- ${EMPLOYER_FIELD_LABELS.availability}`));
    assert.ok(
      !text.includes(`- ${EMPLOYER_FIELD_LABELS.endorsement}`),
      "the email listed a field the student did not approve",
    );
    assert.ok(!text.includes(`- ${EMPLOYER_FIELD_LABELS.resume}`));
  });

  it("omits the subsidy line entirely when it was not approved", () => {
    // It used to print unconditionally, justified as harmless because the
    // sentence says nothing about the student. An email cannot be un-sent, and
    // "what goes out is what was approved" is not a rule with a harmlessness
    // exception.
    const { text } = build(packet(["candidate_name"]));

    assert.ok(
      !text.includes(SUBSIDY_FALLBACK_LINE),
      "the fallback subsidy line was sent despite being left out of the packet",
    );
    // And no blank paragraph left where it used to be.
    assert.ok(!/\n\n\n/.test(text), "removing the subsidy line left a double gap");
  });

  it("includes the subsidy line, verified or fallback, when it WAS approved", () => {
    const fallback = build(packet(["candidate_name", "subsidy_line"]));
    assert.ok(fallback.text.includes(SUBSIDY_FALLBACK_LINE));

    const verified = build(
      packet(["candidate_name", "subsidy_line"], {
        subsidyLine: "Ask us about the 50% wage match.",
      }),
    );
    assert.ok(verified.text.includes("Ask us about the 50% wage match."));
    assert.ok(
      !verified.text.includes(SUBSIDY_FALLBACK_LINE),
      "both the verified line and the fallback were sent",
    );
  });

  it("carries the response link and the abbreviated name, and no full surname", () => {
    const { text, subject } = build(packet(ALL_FIELDS));
    assert.ok(text.includes("https://visionquest.example.test/connect/tokentokentoken"));
    assert.ok(text.includes("Dana R."));
    assert.ok(!text.includes("Whitaker"));
    assert.ok(subject.includes("Production Associate"));
  });
});
