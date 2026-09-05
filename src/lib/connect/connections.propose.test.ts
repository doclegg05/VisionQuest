// =============================================================================
// proposeConnection and approveConnection.
//
// connections.send.test.ts covers the half where information leaves the
// program. This file covers the two steps before that, which decide WHAT will
// leave and whether the student agreed to it.
//
// Four behaviours here are load-bearing and were each wrong once:
//
//   1. The packet is assembled BEFORE the row exists and written IN the
//      INSERT. Assembling afterwards meant an UPDATE that left `status` at
//      "proposed", which the student RLS policy's WITH CHECK rejects — so
//      under Sage's student-context call the packet write raised 42501 and
//      left a dead row holding the permanent (studentId, jobLeadId) key.
//   2. A throwing assembler therefore leaves NO row, rather than an
//      un-approvable proposal squatting on that key forever.
//   3. Only an OPEN lead is proposable, which is also the do-not-contact
//      check: `updateEmployer` pauses an employer's leads when they ask not to
//      be contacted.
//   4. Approval FREEZES the packet. What the student saw on the card is what
//      the employer gets, whatever the résumé says the next morning.
// =============================================================================

import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// ---- Collaborators ---------------------------------------------------------

const leadFindUnique = mock.fn(async () => LEAD as unknown);
const connectionFindUnique = mock.fn(async () => null as unknown);
const connectionFindFirst = mock.fn(async () => PROPOSED_ROW as unknown);
/**
 * `hasRevokedEmployerReferral` asks two questions through the same method — is
 * there an ACTIVE grant, and is there a REVOKED one — and only "revoked with
 * no active grant" is a refusal. Never having been asked is not. So the mock
 * answers by the `revokedAt` filter rather than by call order.
 */
let activeConsent: unknown = { id: "consent1" };
let revokedConsent: unknown = null;
const consentFindFirst = mock.fn(async (args: { where: { revokedAt?: unknown } }) =>
  args.where.revokedAt === null ? activeConsent : revokedConsent,
);
const enrollmentFindFirst = mock.fn(async () => null as unknown);
const connectionCreate = mock.fn(async () => ({ id: "conn1" }));
const eventCreate = mock.fn(async () => ({}));
const assemblePacket = mock.fn(async () => PACKET as unknown);
const renderPacketPdf = mock.fn(async () => "file1" as string | null);
const transitionConnection = mock.fn(async () => ({}));
const grantConsent = mock.fn(async () => ({}));
const auditEvents: Record<string, unknown>[] = [];

const tx = {
  connection: { create: (...a: unknown[]) => connectionCreate(...(a as [])) },
  connectionEvent: { create: (...a: unknown[]) => eventCreate(...(a as [])) },
};

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      jobLead: { findUnique: (...a: unknown[]) => leadFindUnique(...(a as [])) },
      connection: {
        findUnique: (...a: unknown[]) => connectionFindUnique(...(a as [])),
        findFirst: (...a: unknown[]) => connectionFindFirst(...(a as [])),
      },
      consentRecord: {
        findFirst: (...a: unknown[]) => consentFindFirst(...(a as [Parameters<typeof consentFindFirst>[0]])),
      },
      studentClassEnrollment: {
        findFirst: (...a: unknown[]) => enrollmentFindFirst(...(a as [])),
      },
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    },
    prismaAdmin: {},
  },
});

mock.module("./packet", {
  namedExports: {
    assemblePacket: (...a: unknown[]) => assemblePacket(...(a as [])),
    renderPacketPdf: (...a: unknown[]) => renderPacketPdf(...(a as [])),
    packetAsJson: (packet: unknown) => packet,
    parsePacket: (raw: unknown) => raw ?? null,
  },
});

mock.module("./pipeline", {
  namedExports: {
    transitionConnection: (...a: unknown[]) => transitionConnection(...(a as [])),
    isConnectionStatus: () => true,
    TERMINAL_CONNECTION_STATUSES: ["withdrawn", "closed", "not_now"],
    POST_HIRE_STATUSES: ["hired", "started", "retained_30", "retained_60", "retained_90"],
  },
});

mock.module("@/lib/consent", {
  namedExports: { grantConsent: (...a: unknown[]) => grantConsent(...(a as [])) },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: async (event: Record<string, unknown>) => {
      auditEvents.push(event);
    },
  },
});

let proposeConnection: typeof import("./connections").proposeConnection;
let approveConnection: typeof import("./connections").approveConnection;

before(async () => {
  const mod = await import("./connections");
  proposeConnection = mod.proposeConnection;
  approveConnection = mod.approveConnection;
});

// ---- Fixtures --------------------------------------------------------------

const LEAD = {
  id: "lead1",
  employerId: "emp1",
  status: "open",
  title: "Production Associate",
  employerName: "Beckley Components",
  classId: "class1",
};

const PACKET = {
  resumeVersionId: "rv1",
  coverLetterId: "cl1",
  resumeFileUploadId: null,
  endorsement: "",
  includedCertIds: ["cert1"],
  candidateName: "Dana W.",
  certifications: ["Forklift Operator"],
  availabilitySummary: "Monday: mornings",
  earliestStart: null,
  subsidyLine: "Ask us about money for hiring.",
  includedFields: ["candidate_name", "resume", "subsidy_line"],
};

const PROPOSED_ROW = { id: "conn1", status: "proposed", packet: PACKET };

const PROPOSE_INPUT = {
  studentId: "stu1",
  jobLeadId: "lead1",
  proposedById: "tea1",
  proposedVia: "teacher" as const,
};

beforeEach(() => {
  auditEvents.length = 0;
  for (const fn of [
    leadFindUnique,
    connectionFindUnique,
    connectionFindFirst,
    consentFindFirst,
    enrollmentFindFirst,
    connectionCreate,
    eventCreate,
    assemblePacket,
    renderPacketPdf,
    transitionConnection,
    grantConsent,
  ]) {
    fn.mock.resetCalls();
  }
  leadFindUnique.mock.mockImplementation(async () => LEAD);
  connectionFindUnique.mock.mockImplementation(async () => null);
  connectionFindFirst.mock.mockImplementation(async () => PROPOSED_ROW);
  activeConsent = { id: "consent1" };
  revokedConsent = null;
  assemblePacket.mock.mockImplementation(async () => PACKET);
  renderPacketPdf.mock.mockImplementation(async () => "file1");
  connectionCreate.mock.mockImplementation(async () => ({ id: "conn1" }));
});

// ---------------------------------------------------------------------------

describe("proposeConnection", () => {
  it("writes the packet IN the insert, in one transaction with its event", async () => {
    const result = await proposeConnection(PROPOSE_INPUT);

    assert.equal(result.id, "conn1");
    assert.equal(connectionCreate.mock.callCount(), 1);

    const [args] = connectionCreate.mock.calls[0].arguments as unknown as [
      { data: Record<string, unknown> },
    ];
    assert.equal(args.data.status, "proposed");
    assert.deepEqual(args.data.packet, PACKET);
    assert.equal(args.data.classId, "class1");

    // The event is written on the same tx client, so a crash cannot leave a
    // proposal with no ledger row — the ledger is what /memory is built from.
    assert.equal(eventCreate.mock.callCount(), 1);
    const [eventArgs] = eventCreate.mock.calls[0].arguments as unknown as [
      { data: Record<string, unknown> },
    ];
    assert.equal(eventArgs.data.connectionId, "conn1");
    assert.equal(eventArgs.data.fromStatus, null);
    assert.equal(eventArgs.data.toStatus, "proposed");
  });

  it("assembles the packet BEFORE the row exists", async () => {
    // Order, not just presence. Assembling afterwards meant a follow-up UPDATE
    // that left status "proposed", which the student RLS policy refuses — and
    // the dead row then held the permanent (studentId, jobLeadId) key.
    const order: string[] = [];
    assemblePacket.mock.mockImplementation(async () => {
      order.push("assemble");
      return PACKET;
    });
    connectionCreate.mock.mockImplementation(async () => {
      order.push("create");
      return { id: "conn1" };
    });

    await proposeConnection(PROPOSE_INPUT);

    assert.deepEqual(order, ["assemble", "create"]);
  });

  it("leaves NO row when assembly throws", async () => {
    assemblePacket.mock.mockImplementation(async () => {
      throw new Error("no résumé, no lead, no anything");
    });

    await assert.rejects(() => proposeConnection(PROPOSE_INPUT), /no résumé/);

    assert.equal(
      connectionCreate.mock.callCount(),
      0,
      "a failed assembly must not squat on the (studentId, jobLeadId) key",
    );
  });

  it("refuses a lead that is not open — which is also the do-not-contact check", async () => {
    // `updateEmployer` pauses an employer's open leads when they go
    // do_not_contact, so refusing a non-open lead here refuses them too,
    // without a second query that someone could later forget to write.
    for (const status of ["paused", "filled", "closed"]) {
      leadFindUnique.mock.mockImplementation(async () => ({ ...LEAD, status }));
      await assert.rejects(
        () => proposeConnection(PROPOSE_INPUT),
        /not open/i,
        `a "${status}" lead was proposable`,
      );
    }
    assert.equal(assemblePacket.mock.callCount(), 0);
  });

  it("refuses a second proposal for the same student and lead", async () => {
    connectionFindUnique.mock.mockImplementation(async () => ({
      id: "conn0",
      status: "closed",
    }));

    await assert.rejects(() => proposeConnection(PROPOSE_INPUT), /already a connection/i);
    assert.equal(connectionCreate.mock.callCount(), 0);
  });

  it("refuses when the student turned employer introductions OFF", async () => {
    // Asking again on a card would be asking them to re-answer a question they
    // already answered, and the answer was no.
    activeConsent = null;
    revokedConsent = { id: "consent0" };

    await assert.rejects(() => proposeConnection(PROPOSE_INPUT), /turned off/i);
    assert.equal(
      assemblePacket.mock.callCount(),
      0,
      "a revoked student's résumé was tailored anyway",
    );
  });

  it("attributes a Sage-raised proposal to the STUDENT, not to a teacher", async () => {
    await proposeConnection({ ...PROPOSE_INPUT, proposedVia: "sage", proposedById: "stu1" });

    const [eventArgs] = eventCreate.mock.calls[0].arguments as unknown as [
      { data: Record<string, unknown> },
    ];
    assert.equal(eventArgs.data.actorType, "student");
    assert.equal(auditEvents[0].actorRole, "student");
  });

  it("audits the proposal without putting the student in the payload", async () => {
    await proposeConnection(PROPOSE_INPUT);

    const [event] = auditEvents;
    assert.equal(event.action, "connect.connection.proposed");
    assert.equal(event.targetType, "connection");
    assert.equal(event.targetId, "conn1");
    assert.deepEqual(event.metadata, {
      jobLeadId: "lead1",
      employerId: "emp1",
      via: "teacher",
    });
  });
});

describe("approveConnection", () => {
  it("freezes the packet with its rendered PDF and moves the row once", async () => {
    const frozen = await approveConnection("conn1", "stu1");

    assert.equal(frozen.resumeFileUploadId, "file1");

    assert.equal(transitionConnection.mock.callCount(), 1);
    const [input] = transitionConnection.mock.calls[0].arguments as unknown as [
      Record<string, unknown> & { data: Record<string, unknown> },
    ];
    assert.equal(input.to, "student_approved");
    // expectedFrom is what makes a double-tap on the card a conflict rather
    // than a second approval of a row that has already been sent.
    assert.equal(input.expectedFrom, "proposed");
    assert.equal(input.actorType, "student");
    assert.equal(input.actorId, "stu1");
    // Scalar FK, never `consentRecord: { connect }`: the transition writes
    // through updateMany, which takes scalars only.
    assert.equal(input.data.consentRecordId, "consent1");
    assert.ok(!("consentRecord" in input.data));
  });

  it("records the consent BEFORE the packet can move", async () => {
    const order: string[] = [];
    grantConsent.mock.mockImplementation(async () => {
      order.push("consent");
      return {};
    });
    transitionConnection.mock.mockImplementation(async () => {
      order.push("transition");
      return {};
    });

    await approveConnection("conn1", "stu1");

    assert.deepEqual(order, ["consent", "transition"]);
    const [studentId, scope] = grantConsent.mock.calls[0].arguments as unknown as [string, string];
    assert.equal(studentId, "stu1");
    assert.equal(scope, "employer_referral");
  });

  it("refuses to approve when the student has REVOKED employer introductions", async () => {
    // A student can turn introductions off in Settings AFTER a proposal was
    // raised — the card is still on their dashboard. Approving calls
    // `grantConsent`, so without this guard one tap on a stale card would
    // silently put the standing permission back: not just for this connection,
    // but program-wide. Revocation has to survive a card that predates it.
    activeConsent = null;
    revokedConsent = { id: "consent0" };

    await assert.rejects(() => approveConnection("conn1", "stu1"), /turned off/i);

    assert.equal(grantConsent.mock.callCount(), 0, "a revoked consent was re-granted");
    assert.equal(transitionConnection.mock.callCount(), 0);
    assert.equal(
      renderPacketPdf.mock.callCount(),
      0,
      "a revoked student's résumé was rendered anyway",
    );
  });

  it("drops the résumé from the approved list when its PDF did not render", async () => {
    // The employer page gates its résumé block on the rendered file existing,
    // so leaving "resume" in `includedFields` would leave the packet saying
    // one thing and the page doing another — and the /memory disclosure record
    // would promise the employer received a document they never got. The list
    // IS the record of what was shared, so it shrinks when what was shared
    // does.
    renderPacketPdf.mock.mockImplementation(async () => null);

    const frozen = await approveConnection("conn1", "stu1");

    assert.equal(frozen.resumeFileUploadId, null);
    assert.ok(
      !frozen.includedFields.includes("resume"),
      "the packet still promises a résumé the employer will not receive",
    );
    // Everything else the student agreed to is untouched.
    assert.ok(frozen.includedFields.includes("candidate_name"));
    assert.ok(frozen.includedFields.includes("subsidy_line"));
  });

  it("refuses a connection that is not waiting for the student's OK", async () => {
    connectionFindFirst.mock.mockImplementation(async () => ({
      ...PROPOSED_ROW,
      status: "sent",
    }));

    await assert.rejects(() => approveConnection("conn1", "stu1"), /not waiting/i);
    assert.equal(transitionConnection.mock.callCount(), 0);
    assert.equal(grantConsent.mock.callCount(), 0);
  });

  it("refuses somebody else's connection as NOT FOUND", async () => {
    // Scoped by (id, studentId) in one query, so a wrong owner and a missing
    // row are indistinguishable to the caller — a 403 here would confirm that
    // a given connection id exists.
    connectionFindFirst.mock.mockImplementation(async () => null);

    await assert.rejects(() => approveConnection("conn1", "intruder"), /wasn't found/i);

    const [args] = connectionFindFirst.mock.calls[0].arguments as unknown as [
      { where: Record<string, unknown> },
    ];
    assert.deepEqual(args.where, { id: "conn1", studentId: "intruder" });
  });

  it("refuses to approve a row with no packet rather than sending an empty one", async () => {
    connectionFindFirst.mock.mockImplementation(async () => ({
      ...PROPOSED_ROW,
      packet: null,
    }));

    await assert.rejects(() => approveConnection("conn1", "stu1"), /nothing to send/i);
    assert.equal(transitionConnection.mock.callCount(), 0);
  });

  it("audits the approval by the FIELDS agreed, never their values", async () => {
    await approveConnection("conn1", "stu1");

    const [event] = auditEvents;
    assert.equal(event.action, "connect.connection.approved");
    assert.deepEqual(event.metadata, {
      fields: ["candidate_name", "resume", "subsidy_line"],
    });
    // The audit row is the record of consent, not a second copy of the packet.
    assert.ok(!JSON.stringify(event).includes("Dana W."));
  });
});
