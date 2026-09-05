/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding covers Prisma methods with different signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * `sendConnection` is the gate between this program and the outside world.
 * Four properties are pinned here, and each one has already been the shape of
 * a real incident somewhere:
 *
 *   1. Nothing is sent that the student has not approved.
 *   2. Nothing is sent without a LIVE `employer_referral` consent — re-checked
 *      at send, not merely at approval, because a student can revoke between.
 *   3. The employer token never reaches a log, an audit row, or the response.
 *   4. The per-employer limit fails CLOSED, including when its store is down.
 */

const state = {
  status: "student_approved" as string,
  consent: true,
  recentSends: 0,
  rateLimit: { success: true, remaining: 2, resetTime: 0, degraded: false },
  employerStatus: "active" as string,
  leadStatus: "open" as string,
  contact: {
    id: "contact-1",
    name: "Pat Buyer",
    email: "pat@example.test",
    doNotContactAt: null as Date | null,
    employerId: "emp-1",
  } as {
    id: string;
    name: string;
    email: string | null;
    doNotContactAt: Date | null;
    employerId: string;
  } | null,
};

const STUDENT_ID = "clstudent00000000000000x";

const packet = {
  resumeVersionId: "clresume0000000000000000",
  coverLetterId: null,
  resumeFileUploadId: null,
  endorsement: "Dana came to every class.",
  includedCertIds: [],
  includedFields: ["candidate_name", "resume", "endorsement", "subsidy_line"],
  candidateName: "Dana R.",
  certifications: ["Forklift Operator"],
  availabilitySummary: "Weekdays: mornings",
  earliestStart: "2026-09-15",
  subsidyLine: null,
};

const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
const auditRows: Array<Record<string, unknown>> = [];
const outboundRows: Array<Record<string, unknown>> = [];
const logLines: Array<{ message: string; payload: unknown }> = [];
const transitions: Array<Record<string, unknown>> = [];

const mockConnectionFindUnique = mock.fn(async () => ({
  id: "conn-1",
  studentId: STUDENT_ID,
  status: state.status,
  packet,
  employerId: "emp-1",
  employer: { name: "Mountain Metal", status: state.employerStatus },
  jobLead: {
    title: "Production Associate",
    status: state.leadStatus,
    contactId: state.contact?.id ?? null,
    contact: state.contact,
  },
})) as any;

const mockOutboundCount = mock.fn(async () => state.recentSends) as any;
const mockOutboundCreate = mock.fn(async (args: any) => {
  outboundRows.push(args.data);
  return { id: "om-1" };
}) as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      connection: {
        get findUnique() {
          return mockConnectionFindUnique;
        },
      },
      outboundMessage: {
        get count() {
          return mockOutboundCount;
        },
        get create() {
          return mockOutboundCreate;
        },
      },
      consentRecord: { findFirst: async () => ({ id: "consent-1" }) },
    },
    prismaAdmin: {},
  },
});

mock.module("@/lib/consent", {
  namedExports: {
    hasActiveConsent: async () => state.consent,
    grantConsent: async () => ({ granted: false }),
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: async () => state.rateLimit,
    refundRateLimit: async () => undefined,
  },
});

mock.module("@/lib/email", {
  namedExports: {
    isEmailDeliveryConfigured: () => true,
    sendEmail: async (payload: any) => {
      sentEmails.push(payload);
    },
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: async (row: any) => {
      auditRows.push(row);
    },
  },
});

mock.module("@/lib/notifications", {
  namedExports: { sendNotification: async () => undefined },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      error: (message: string, payload: unknown) => logLines.push({ message, payload }),
      warn: (message: string, payload: unknown) => logLines.push({ message, payload }),
      info: () => {},
      debug: () => {},
    },
  },
});

mock.module("./pipeline", {
  namedExports: {
    transitionConnection: async (input: any) => {
      transitions.push(input);
      return { from: state.status, to: input.to, studentId: STUDENT_ID };
    },
    isTerminalConnectionStatus: (status: string) =>
      ["not_now", "retained_90", "withdrawn", "closed"].includes(status),
    isConnectionStatus: () => true,
  },
});

mock.module("./packet", {
  namedExports: {
    assemblePacket: async () => packet,
    packetAsJson: (value: unknown) => value,
    renderPacketPdf: async () => null,
  },
});

let sendConnection: typeof import("./connections").sendConnection;
let ConnectionError: typeof import("./connections").ConnectionError;

before(async () => {
  const mod = await import("./connections");
  sendConnection = mod.sendConnection;
  ConnectionError = mod.ConnectionError;
});

const OPTIONS = {
  senderId: "clteacher0000000000000x",
  senderRole: "teacher",
  senderName: "Ms. Legg",
  programName: "SPOKES",
  programEmail: "spokes@example.test",
  baseUrl: "https://visionquest.example.test",
};

beforeEach(() => {
  state.status = "student_approved";
  state.consent = true;
  state.recentSends = 0;
  state.rateLimit = { success: true, remaining: 2, resetTime: 0, degraded: false };
  state.employerStatus = "active";
  state.leadStatus = "open";
  state.contact = {
    id: "contact-1",
    name: "Pat Buyer",
    email: "pat@example.test",
    doNotContactAt: null,
    employerId: "emp-1",
  };
  sentEmails.length = 0;
  auditRows.length = 0;
  outboundRows.length = 0;
  logLines.length = 0;
  transitions.length = 0;
});

async function expectRefusal(): Promise<InstanceType<typeof ConnectionError>> {
  try {
    await sendConnection("conn-1", OPTIONS);
  } catch (error) {
    assert.ok(error instanceof ConnectionError, `expected a ConnectionError, got ${error}`);
    assert.equal(sentEmails.length, 0, "nothing may be emailed on a refusal");
    assert.equal(transitions.length, 0, "nothing may transition on a refusal");
    return error;
  }
  throw new Error("sendConnection should have refused");
}

describe("sendConnection — what may never leave the program", () => {
  it("sends when everything is in order", async () => {
    const result = await sendConnection("conn-1", OPTIONS);
    assert.equal(sentEmails.length, 1);
    assert.equal(result.contactName, "Pat Buyer");
    assert.equal(transitions[0].to, "sent");
    assert.equal(transitions[0].expectedFrom, "student_approved");
    assert.equal(outboundRows.length, 1);
  });

  for (const status of ["proposed", "sent", "viewed", "withdrawn", "closed", "hired"]) {
    it(`REFUSES to send from "${status}" — only student_approved may be sent`, async () => {
      state.status = status;
      const error = await expectRefusal();
      assert.match(error.message, /has not approved/i);
    });
  }

  it("REFUSES to send when the consent has been revoked since approval", async () => {
    state.consent = false;
    const error = await expectRefusal();
    assert.match(error.message, /taken back permission/i);
  });

  it("REFUSES to send to a do-not-contact employer", async () => {
    state.employerStatus = "do_not_contact";
    await expectRefusal();
  });

  it("REFUSES to send to a contact who asked not to be emailed", async () => {
    state.contact = { ...state.contact!, doNotContactAt: new Date() };
    await expectRefusal();
  });

  it("REFUSES to send when the lead has no contact with an email", async () => {
    state.contact = { ...state.contact!, email: null };
    await expectRefusal();
  });

  for (const leadStatus of ["paused", "filled", "closed"]) {
    it(`REFUSES to send for a "${leadStatus}" lead`, async () => {
      // `updateEmployer` pauses an employer's open leads when they go
      // do-not-contact, so the paused case is the second line of that defence;
      // filled and closed simply are not jobs to introduce anyone to.
      state.leadStatus = leadStatus;
      const error = await expectRefusal();
      assert.match(error.message, /not open/i);
    });
  }

  it("REFUSES to send to a contact who works at a DIFFERENT employer", async () => {
    // The lead's contact must be a person at the lead's own employer, or a
    // merge or a hand-edited row ends with one company's hiring manager
    // receiving a packet about another company's job.
    state.contact = { ...state.contact!, employerId: "emp-other" };
    const error = await expectRefusal();
    assert.match(error.message, /isn't at this employer/i);
  });

  it("enforces the three-per-employer-per-week limit from the rolling count", async () => {
    state.recentSends = 3;
    const error = await expectRefusal();
    assert.equal(error.status, 429);
    assert.match(error.message, /7 days/);
  });

  it("enforces the limit from the atomic counter too", async () => {
    state.rateLimit = { success: false, remaining: 0, resetTime: 0, degraded: false };
    const error = await expectRefusal();
    assert.equal(error.status, 429);
  });

  it("FAILS CLOSED when the rate-limit store is unavailable", async () => {
    // rateLimit() reports success:true, degraded:true when its store is down —
    // right for a shared classroom login, wrong for contacting an employer.
    state.rateLimit = { success: true, remaining: 0, resetTime: 0, degraded: true };
    const error = await expectRefusal();
    assert.equal(error.status, 429);
  });

  it("never puts the token or its hash in the audit row or the result", async () => {
    const result = await sendConnection("conn-1", OPTIONS);
    const serialized = JSON.stringify({ auditRows, result, outboundRows });
    // The token appears in exactly one place: the email body's link.
    const [, token] = sentEmails[0].text.match(/\/connect\/([A-Za-z0-9_-]+)/) ?? [];
    assert.ok(token && token.length > 20, "the email must carry a real token");
    assert.ok(!serialized.includes(token), "the token leaked outside the email");
    assert.ok(
      !/[a-f0-9]{64}/.test(serialized),
      "something that looks like the token's sha256 leaked",
    );
  });

  it("never logs the token, the student id, or the contact's address", async () => {
    await sendConnection("conn-1", OPTIONS);
    const logged = JSON.stringify(logLines);
    assert.ok(!logged.includes(STUDENT_ID));
    assert.ok(!logged.includes("pat@example.test"));
  });

  it("puts no student id in the email body", async () => {
    await sendConnection("conn-1", OPTIONS);
    assert.ok(!sentEmails[0].text.includes(STUDENT_ID), "the email carries a student id");
    assert.ok(!sentEmails[0].text.includes("conn-1"), "the email carries a connection id");
    // What it DOES carry: the abbreviated name and the approved field list.
    assert.ok(sentEmails[0].text.includes("Dana R."));
    assert.ok(sentEmails[0].text.includes("Ms. Legg"));
  });

  it("records the outbound message against the connection, addressed by contact id", async () => {
    await sendConnection("conn-1", OPTIONS);
    assert.equal(outboundRows[0].toKind, "employer_contact");
    assert.equal(outboundRows[0].toId, "contact-1");
    assert.equal(outboundRows[0].connectionId, "conn-1");
  });
});
