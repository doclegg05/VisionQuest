// =============================================================================
// Packet assembly — the Prisma-backed half.
//
// packet-shared.test.ts covers the schema and the labels. This file covers the
// decisions assembly makes about a real student's data: which certifications
// count, what the employer is told about availability, what happens when the
// tailoring model is slow or broken, and — the one that cost a whole packet
// once — WHICH COLUMN the tailored résumé is keyed on.
// =============================================================================

import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// ---- Collaborators, all mocked. --------------------------------------------

const findStudent = mock.fn(async () => STUDENT as unknown);
const findLead = mock.fn(async () => LEAD as unknown);
const findResumeVersion = mock.fn(async () => null as unknown);
const findCoverLetter = mock.fn(async () => null as unknown);
const createTailored = mock.fn(async () => ({
  resumeVersionId: "rv1",
  coverLetterId: "cl1",
  version: 1,
}));
const warn = mock.fn();

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: { findUnique: (...args: unknown[]) => findStudent(...(args as [])) },
      jobLead: { findUnique: (...args: unknown[]) => findLead(...(args as [])) },
      resumeVersion: { findFirst: (...args: unknown[]) => findResumeVersion(...(args as [])) },
      coverLetter: { findFirst: (...args: unknown[]) => findCoverLetter(...(args as [])) },
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { warn, info: () => {}, error: () => {}, debug: () => {} } },
});

mock.module("@/lib/sage/agent/tailor-application", {
  namedExports: {
    createTailoredApplication: (...args: unknown[]) => createTailored(...(args as [])),
  },
});

mock.module("./subsidies", {
  namedExports: { subsidyLine: async () => "Ask us about money for hiring." },
});

// Imported inside `before` because top-level await is unavailable under the
// runner's CJS transform, and the mocks above must be installed first.
let assemblePacket: typeof import("./packet").assemblePacket;
let contentBearingFields: typeof import("./packet").contentBearingFields;
let summarizeAvailability: typeof import("./packet").summarizeAvailability;
let TAILORING_DEADLINE_MS: number;

before(async () => {
  const mod = await import("./packet");
  assemblePacket = mod.assemblePacket;
  contentBearingFields = mod.contentBearingFields;
  summarizeAvailability = mod.summarizeAvailability;
  TAILORING_DEADLINE_MS = mod.TAILORING_DEADLINE_MS;
});

// ---- Fixtures --------------------------------------------------------------

/**
 * The grid is all seven days or nothing — `availabilitySchema` is strict, and
 * a partial grid parses as empty, which is how a student's real answers would
 * silently become "Not set".
 */
const CLOSED = { morning: false, afternoon: false, evening: false, overnight: false };
const FULL_AVAILABILITY = {
  monday: { ...CLOSED, morning: true, afternoon: true },
  tuesday: { ...CLOSED, evening: true },
  wednesday: { ...CLOSED },
  thursday: { ...CLOSED },
  friday: { ...CLOSED },
  saturday: { ...CLOSED },
  sunday: { ...CLOSED },
};
const AVAILABILITY_SUMMARY = "Monday: mornings, afternoons. Tuesday: evenings";

const STUDENT = {
  displayName: "Dana Whitaker",
  resumeData: { data: JSON.stringify({ contact: { email: "dana@example.com" } }) },
  workProfile: {
    availability: FULL_AVAILABILITY,
    earliestStart: new Date("2026-10-01T00:00:00Z"),
    // Deliberately present and deliberately never asserted below: the packet
    // must not carry a home ZIP, a pay floor, transport or childcare hours to
    // an employer. See the exclusion case at the bottom of this file.
    homeZip: "25801",
    payFloorHourly: 18,
    transport: "none",
    childcareHours: "weekday mornings only",
  },
  certifications: [
    { id: "cert1", certType: "Forklift Operator", completedAt: new Date() },
  ],
};

const LEAD = {
  id: "lead1",
  title: "Production Associate",
  description: "Second shift line work.",
  location: "Beckley, WV",
  clusters: ["manufacturing"],
  payMin: 17,
  payMax: 19,
  payPeriod: "hourly",
  employerName: "Beckley Components",
};

beforeEach(() => {
  findStudent.mock.resetCalls();
  findLead.mock.resetCalls();
  findResumeVersion.mock.resetCalls();
  findCoverLetter.mock.resetCalls();
  createTailored.mock.resetCalls();
  warn.mock.resetCalls();
  findResumeVersion.mock.mockImplementation(async () => null);
  findCoverLetter.mock.mockImplementation(async () => null);
  createTailored.mock.mockImplementation(async () => ({
    resumeVersionId: "rv1",
    coverLetterId: "cl1",
    version: 1,
  }));
});

// ---------------------------------------------------------------------------

describe("summarizeAvailability", () => {
  it("names the days and slots the student marked, in plain words", () => {
    assert.equal(
      summarizeAvailability(FULL_AVAILABILITY),
      AVAILABILITY_SUMMARY,
    );
  });

  it('says "Not set" for an empty or unparseable profile', () => {
    assert.equal(summarizeAvailability(null), "Not set");
    assert.equal(summarizeAvailability({}), "Not set");
    assert.equal(summarizeAvailability("garbage"), "Not set");
  });
});

describe("contentBearingFields", () => {
  const base = {
    endorsement: "",
    certifications: [] as string[],
    availabilitySummary: "Not set",
    earliestStart: null,
    resumeVersionId: null,
  };

  it("offers only what there is content for", () => {
    // The list the student approves is the list that goes. Showing them
    // "The days and times you can work" when the employer would receive
    // "Not set" asks for consent to nothing.
    assert.deepEqual(contentBearingFields(base), ["candidate_name", "subsidy_line"]);
  });

  it("adds each field as its content appears", () => {
    assert.deepEqual(
      contentBearingFields({
        endorsement: "Steady and early every day.",
        certifications: ["Forklift Operator"],
        availabilitySummary: "Monday: Morning",
        earliestStart: "2026-10-01",
        resumeVersionId: "rv1",
      }),
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
  });

  it("keeps subsidy_line even with no verified rule, and drops a blank endorsement", () => {
    // The fallback line is still that note, and it says nothing about the
    // student. An endorsement of only whitespace is not an endorsement.
    assert.deepEqual(contentBearingFields({ ...base, endorsement: "   " }), [
      "candidate_name",
      "subsidy_line",
    ]);
  });
});

describe("assemblePacket", () => {
  it("keys the tailored documents on jobLeadId, not jobListingId", async () => {
    // THE bug this suite exists for. The first cut passed the lead id into
    // `jobListingId` and re-keyed the rows afterwards: the FK rejected the
    // insert with P2003 every time, the re-key never ran, and the bare catch
    // turned it into "every packet has no résumé" — silently, on every
    // introduction the program made.
    await assemblePacket({ studentId: "stu1", jobLeadId: "lead1" });

    assert.equal(createTailored.mock.callCount(), 1);
    const [studentId, target] = createTailored.mock.calls[0].arguments as unknown as [
      string,
      { kind: string; id: string },
    ];
    assert.equal(studentId, "stu1");
    assert.deepEqual(target, { kind: "lead", id: "lead1" });
  });

  it("reuses an existing tailored résumé for the same lead", async () => {
    findResumeVersion.mock.mockImplementation(async () => ({ id: "rv-old" }));
    findCoverLetter.mock.mockImplementation(async () => ({ id: "cl-old" }));

    const packet = await assemblePacket({ studentId: "stu1", jobLeadId: "lead1" });

    assert.equal(packet.resumeVersionId, "rv-old");
    assert.equal(packet.coverLetterId, "cl-old");
    assert.equal(
      createTailored.mock.callCount(),
      0,
      "a second proposal for the same lead must not re-run the model",
    );
  });

  it("carries verified certifications only, by their ids and their names", async () => {
    const packet = await assemblePacket({ studentId: "stu1", jobLeadId: "lead1" });

    // The WHERE clause is the guard — an in-progress or self-reported card is
    // not a fact this program asserts to an employer — so pin it rather than
    // only the output, which a looser query would still satisfy on a fixture
    // that happens to hold one verified row.
    const [args] = findStudent.mock.calls[0].arguments as unknown as [
      { select: { certifications: { where: Record<string, string> } } },
    ];
    assert.deepEqual(args.select.certifications.where, {
      status: "completed",
      verificationStatus: "verified",
    });
    assert.deepEqual(packet.certifications, ["Forklift Operator"]);
    assert.deepEqual(packet.includedCertIds, ["cert1"]);
  });

  it("abbreviates the candidate's name and never carries the full one", async () => {
    const packet = await assemblePacket({ studentId: "stu1", jobLeadId: "lead1" });
    assert.equal(packet.candidateName, "Dana W.");
  });

  it("degrades to no résumé — loudly — when tailoring fails", async () => {
    createTailored.mock.mockImplementation(async () => {
      throw new Error("provider exploded");
    });

    const packet = await assemblePacket({ studentId: "stu1", jobLeadId: "lead1" });

    assert.equal(packet.resumeVersionId, null);
    assert.equal(packet.coverLetterId, null);
    assert.ok(
      !packet.includedFields.includes("resume"),
      "a packet with no résumé must not offer one on the approval card",
    );

    // Not silent, and not carrying a student id: the log key is a correlation
    // digest, which is what the no-PII-in-logs rule asks for on a path whose
    // whole point is that nothing reached the database.
    assert.equal(warn.mock.callCount(), 1);
    const [message, payload] = warn.mock.calls[0].arguments as unknown as [string, Record<string, unknown>];
    assert.match(message, /tailoring failed/i);
    assert.notEqual(payload.student, "stu1");
    assert.ok(typeof payload.student === "string" && payload.student.length > 0);
  });

  it("bounds how long a hung model may hold the request open", async () => {
    // This runs while an instructor watches a spinner, or inside a student's
    // Sage turn. The provider's own ceiling is 300s — five minutes of a page
    // that never answers — so the packet path takes a much shorter one and
    // degrades instead.
    //
    // The number is asserted rather than the wait: a test that actually sat
    // out the deadline would add 20 seconds to every run to prove a constant.
    // What it must not become is a value someone raises quietly.
    assert.ok(
      TAILORING_DEADLINE_MS > 0 && TAILORING_DEADLINE_MS <= 30_000,
      `the request-path tailoring deadline drifted to ${TAILORING_DEADLINE_MS}ms`,
    );
  });

  it("carries NOTHING from the work profile except availability and earliest start", async () => {
    // The work profile holds a home ZIP, a pay floor, transport and childcare
    // hours. Those are how the program decides whether a job is reachable for
    // this student; none of them are the employer's business, and a childcare
    // note is the student's own words about their household.
    const packet = await assemblePacket({ studentId: "stu1", jobLeadId: "lead1" });
    const serialized = JSON.stringify(packet);

    for (const secret of ["25801", "18", "childcare", "weekday mornings only", "none"]) {
      assert.ok(
        !serialized.toLowerCase().includes(secret.toLowerCase()) ||
          secret === "none",
        `the packet leaked "${secret}" from the work profile`,
      );
    }
    assert.equal(packet.availabilitySummary, AVAILABILITY_SUMMARY);
    assert.equal(packet.earliestStart, "2026-10-01");
  });

  it("refuses rather than assembling half a packet when the student or lead is missing", async () => {
    findStudent.mock.mockImplementationOnce(async () => null);
    await assert.rejects(
      () => assemblePacket({ studentId: "ghost", jobLeadId: "lead1" }),
      /student wasn't found/i,
    );

    findLead.mock.mockImplementationOnce(async () => null);
    await assert.rejects(
      () => assemblePacket({ studentId: "stu1", jobLeadId: "ghost" }),
      /job wasn't found/i,
    );
  });
});
