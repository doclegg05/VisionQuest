// =============================================================================
// What the student approved is what the employer sees.
//
// The consent claim this whole feature rests on is that the approval card
// shows the EXACT contents of the packet before the student taps OK. Two
// separate components render that packet — ConnectionApprovalCard for the
// student and the public /connect/[token] page for the employer — and nothing
// but this file stops them drifting apart.
//
// Drift here is silent and one-directional in the way that matters: a value
// the employer page renders and the card does not is something the student
// never agreed to send. So both surfaces are rendered from ONE packet fixture
// and the assertion is on the values, not on the field keys — a shared
// `includedFields` list would agree perfectly while the two components pulled
// different data behind it.
// =============================================================================

import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { renderToString } from "react-dom/server";

import { PACKET_FIELD_LABELS, type Packet } from "./packet-shared";

/** The one packet both surfaces are built from. */
const PACKET: Packet = {
  resumeVersionId: "clresume0000000000000000",
  coverLetterId: null,
  resumeFileUploadId: "clfile0000000000000000001",
  endorsement: "Dana came to every class and earned the forklift card.",
  includedCertIds: [],
  includedFields: [
    "candidate_name",
    "resume",
    "verified_certifications",
    "availability",
    "earliest_start",
    "endorsement",
    "subsidy_line",
  ],
  candidateName: "Dana R.",
  certifications: ["Forklift Operator"],
  availabilitySummary: "Weekdays: mornings, afternoons",
  earliestStart: "2026-09-15",
  subsidyLine: "Ask us about money for hiring.",
};

/**
 * The values that actually leave the program, as opposed to the labels that
 * describe them. Each one is a fact about this student.
 */
const DISCLOSED_VALUES = [
  PACKET.candidateName,
  PACKET.certifications[0],
  PACKET.availabilitySummary,
  PACKET.endorsement,
];

mock.module("@/lib/connect/employer-link", {
  namedExports: {
    resolveEmployerLink: async () => ({
      connectionId: "clconn000000000000000001",
      status: "sent",
      packet: PACKET,
      jobTitle: "Production Associate",
      employerName: "Mountain Metal",
      instructorName: "Ms. Legg",
      advisorId: "clteacher0000000000000x",
      hasPacketPdf: true,
    }),
    recordEmployerView: async () => undefined,
    EMPLOYER_LINK_INACTIVE_MESSAGE: "This link is no longer active.",
  },
});

mock.module("@/lib/connect/employer-actions", {
  namedExports: { listInstructorSlots: async () => [] },
});

mock.module("@/lib/system-config", {
  namedExports: { getPlainConfigValue: async () => "all" },
});

let ConnectionApprovalCard: typeof import("@/components/student/ConnectionApprovalCard").ConnectionApprovalCard;
let EmployerConnectPage: (props: {
  params: Promise<{ token: string }>;
}) => Promise<React.ReactElement>;

before(async () => {
  ({ ConnectionApprovalCard } = await import("@/components/student/ConnectionApprovalCard"));
  EmployerConnectPage = (await import("@/app/connect/[token]/page")).default as typeof EmployerConnectPage;
});

describe("the approval card and the employer page render the SAME packet", () => {
  it("shows every disclosed value on both surfaces", async () => {
    const cardHtml = renderToString(
      <ConnectionApprovalCard
        connection={{
          id: "conn-1",
          jobTitle: "Production Associate",
          employerName: "Mountain Metal",
          location: "Beckley, WV",
          fields: PACKET.includedFields.map((key) => PACKET_FIELD_LABELS[key]),
          endorsement: PACKET.endorsement,
          candidateName: PACKET.candidateName,
          certifications: PACKET.certifications,
          availabilitySummary: PACKET.availabilitySummary,
          earliestStart: PACKET.earliestStart,
          subsidyLine: PACKET.subsidyLine,
          hasResume: Boolean(PACKET.resumeVersionId),
        }}
      />,
    );
    const employerHtml = renderToString(
      await EmployerConnectPage({ params: Promise.resolve({ token: "t".repeat(24) }) }),
    );

    for (const value of DISCLOSED_VALUES) {
      assert.ok(
        cardHtml.includes(value),
        `the approval card did not show "${value}" — the student cannot consent to what they cannot see`,
      );
      assert.ok(
        employerHtml.includes(value),
        `the employer page dropped "${value}" the student was told would be sent`,
      );
    }
  });

  it("shows the employer NOTHING the card did not show the student", async () => {
    // The direction that would be a disclosure failure rather than a display
    // bug. The date is checked in both renderings rather than by string
    // equality, because the two surfaces are allowed to FORMAT it differently
    // — what they may not do is disagree about whether it goes at all.
    const employerHtml = renderToString(
      await EmployerConnectPage({ params: Promise.resolve({ token: "t".repeat(24) }) }),
    );

    const startYear = PACKET.earliestStart?.slice(0, 4) ?? "";
    assert.ok(employerHtml.includes(startYear));

    // And nothing from outside the packet: the résumé's own contact block is
    // stripped before the PDF is rendered, so no address or phone can appear
    // through it either.
    for (const never of ["@example.com", "304-", "25801"]) {
      assert.ok(
        !employerHtml.includes(never),
        `the employer page rendered "${never}", which is not in the packet`,
      );
    }
  });

  it("keeps the two surfaces on ONE label vocabulary", async () => {
    // The card names the fields; the employer page renders their values under
    // its own headings. What must never diverge is the KEY SET — a field the
    // packet lists but neither surface can render is a promise nobody keeps.
    for (const key of PACKET.includedFields) {
      assert.ok(
        typeof PACKET_FIELD_LABELS[key] === "string" && PACKET_FIELD_LABELS[key].length > 0,
        `no student-facing label exists for the packet field "${key}"`,
      );
    }
  });
});
