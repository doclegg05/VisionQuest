import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * The send path is mocked at its two edges — Prisma and Twilio — so the
 * assertions are about the POLICY: nothing is sent without consent, nothing is
 * sent in quiet hours, nothing is sent over the cap, and every send that DOES
 * happen leaves an OutboundMessage row with the links stripped out of it.
 */

interface PreferenceRow {
  id: string;
  studentId: string;
  enabled: boolean;
  destination: string | null;
  smsConsentAt: Date | null;
  smsRevokedAt: Date | null;
}

const state = {
  preference: null as PreferenceRow | null,
  sentTodayCount: 0,
  outboundCreates: [] as Array<Record<string, unknown>>,
  smsCalls: [] as Array<{ to: string; body: string }>,
  smsResult: true,
};

const prismaAdmin = {
  notificationPreference: {
    findFirst: mock.fn(async () => state.preference),
    findMany: mock.fn(async () => (state.preference ? [state.preference] : [])),
    update: mock.fn(async () => state.preference),
  },
  outboundMessage: {
    count: mock.fn(async (_args: { where: Record<string, unknown> }) => state.sentTodayCount),
    create: mock.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.outboundCreates.push(data);
      return { id: `om_${state.outboundCreates.length}`, ...data };
    }),
    findFirst: mock.fn(async () => null),
    updateMany: mock.fn(async () => ({ count: 1 })),
  },
};

mock.module("@/lib/db", { namedExports: { prismaAdmin, prisma: prismaAdmin } });
mock.module("@/lib/sms", {
  namedExports: {
    sendSms: mock.fn(async (to: string, body: string) => {
      state.smsCalls.push({ to, body });
      return state.smsResult;
    }),
    isSmsDeliveryConfigured: () => true,
  },
});

import { SMS_DAILY_CAP, SMS_REFUSAL } from "./sms-policy-shared";

let sendPolicySms: typeof import("./sms-policy").sendPolicySms;

before(async () => {
  ({ sendPolicySms } = await import("./sms-policy"));
});

const STUDENT = "stu_nudge_1";
const CONSENTED: PreferenceRow = {
  id: "pref_1",
  studentId: STUDENT,
  enabled: true,
  destination: "+13045550123",
  smsConsentAt: new Date("2026-08-01T12:00:00Z"),
  smsRevokedAt: null,
};

/** 2026-09-08 14:00Z = Tuesday 10:00 EDT, inside the send window. */
const MIDMORNING = new Date("2026-09-08T14:00:00Z");

function reset() {
  state.preference = { ...CONSENTED };
  state.sentTodayCount = 0;
  state.outboundCreates = [];
  state.smsCalls = [];
  state.smsResult = true;
}

describe("sendPolicySms", () => {
  beforeEach(reset);

  it("sends, and logs the send with the destination absent from the row", async () => {
    const result = await sendPolicySms({
      studentId: STUDENT,
      templateKey: "retention_30",
      body: "SPOKES: Still working at Mountain Metals? Reply Y or N. Reply STOP to stop.",
      expectsReply: "retention:con_1:30",
      connectionId: "con_1",
      now: MIDMORNING,
    });

    assert.equal(result.status, "sent");
    assert.equal(state.smsCalls.length, 1);
    assert.equal(state.smsCalls[0].to, CONSENTED.destination);
    assert.equal(state.outboundCreates.length, 1);
    const row = state.outboundCreates[0];
    assert.equal(row.channel, "sms");
    assert.equal(row.toKind, "student");
    assert.equal(row.toId, STUDENT);
    assert.equal(row.templateKey, "retention_30");
    assert.equal(row.expectsReply, "retention:con_1:30");
    assert.equal(row.connectionId, "con_1");
    assert.equal(row.status, "sent");
    assert.ok(
      !JSON.stringify(row).includes(CONSENTED.destination as string),
      "the phone number must never be written into the outbound log",
    );
  });

  it("does not send without a recorded consent, and writes no log row", async () => {
    state.preference = { ...CONSENTED, smsConsentAt: null };
    const result = await sendPolicySms({
      studentId: STUDENT,
      templateKey: "weekly_jobs",
      body: "SPOKES: 3 new jobs near you this week. Reply Y and Sage will show them. Reply STOP to stop.",
      now: MIDMORNING,
    });

    assert.equal(result.status, "refused");
    assert.equal(result.status === "refused" && result.reason, SMS_REFUSAL.noConsent);
    assert.equal(state.smsCalls.length, 0, "no text may leave without consent");
    assert.equal(state.outboundCreates.length, 0);
  });

  it("does not send after a STOP, even though consent was once given", async () => {
    state.preference = { ...CONSENTED, smsRevokedAt: new Date("2026-09-02T00:00:00Z") };
    const result = await sendPolicySms({
      studentId: STUDENT,
      templateKey: "weekly_jobs",
      body: "SPOKES: 3 new jobs near you this week. Reply Y and Sage will show them. Reply STOP to stop.",
      now: MIDMORNING,
    });
    assert.equal(result.status, "refused");
    assert.equal(state.smsCalls.length, 0);
  });

  it("defers inside quiet hours rather than sending", async () => {
    const atNight = new Date("2026-09-09T02:00:00Z"); // 22:00 EDT
    const result = await sendPolicySms({
      studentId: STUDENT,
      templateKey: "weekly_jobs",
      body: "SPOKES: 3 new jobs near you this week. Reply Y and Sage will show them. Reply STOP to stop.",
      now: atNight,
    });
    assert.equal(result.status, "deferred");
    assert.equal(result.status === "deferred" && result.reason, SMS_REFUSAL.quietHours);
    assert.equal(state.smsCalls.length, 0);
    assert.equal(state.outboundCreates.length, 0);
  });

  it("defers once the recipient has already had the day's cap", async () => {
    state.sentTodayCount = SMS_DAILY_CAP;
    const result = await sendPolicySms({
      studentId: STUDENT,
      templateKey: "weekly_jobs",
      body: "SPOKES: 3 new jobs near you this week. Reply Y and Sage will show them. Reply STOP to stop.",
      now: MIDMORNING,
    });
    assert.equal(result.status, "deferred");
    assert.equal(result.status === "deferred" && result.reason, SMS_REFUSAL.dailyCap);
    assert.equal(state.smsCalls.length, 0);
  });

  it("counts the cap over the recipient's own local day, not the last 24 hours", async () => {
    await sendPolicySms({
      studentId: STUDENT,
      templateKey: "weekly_jobs",
      body: "SPOKES: 3 new jobs near you this week. Reply Y and Sage will show them. Reply STOP to stop.",
      now: MIDMORNING,
    });
    const lastCall = prismaAdmin.outboundMessage.count.mock.calls.at(-1);
    assert.ok(lastCall, "the cap was never counted");
    const countArgs = lastCall.arguments[0] as unknown as {
      where: { sentAt: { gte: Date; lt: Date }; toId: string; channel: string; toKind: string };
    };
    // 2026-09-08 00:00 EDT = 04:00Z, and the window ends at the next local midnight.
    assert.equal(countArgs.where.sentAt.gte.toISOString(), "2026-09-08T04:00:00.000Z");
    assert.equal(countArgs.where.sentAt.lt.toISOString(), "2026-09-09T04:00:00.000Z");
    assert.equal(countArgs.where.toId, STUDENT);
    assert.equal(countArgs.where.channel, "sms");
    assert.equal(countArgs.where.toKind, "student");
  });

  it("stores the body with any link replaced by [link]", async () => {
    await sendPolicySms({
      studentId: STUDENT,
      templateKey: "weekly_jobs",
      body: "SPOKES: see https://visionquest.onrender.com/career now Reply STOP to stop.",
      now: MIDMORNING,
    });
    assert.equal(
      state.outboundCreates[0].body,
      "SPOKES: see [link] now Reply STOP to stop.",
    );
    assert.equal(
      state.smsCalls[0].body,
      "SPOKES: see https://visionquest.onrender.com/career now Reply STOP to stop.",
      "the recipient still gets the real link; only the stored copy is redacted",
    );
  });

  it("records a failed delivery instead of pretending it went out", async () => {
    state.smsResult = false;
    const result = await sendPolicySms({
      studentId: STUDENT,
      templateKey: "weekly_jobs",
      body: "SPOKES: 3 new jobs near you this week. Reply Y and Sage will show them. Reply STOP to stop.",
      now: MIDMORNING,
    });
    assert.equal(result.status, "failed");
    assert.equal(state.outboundCreates.length, 1);
    assert.equal(state.outboundCreates[0].status, "failed");
    assert.equal(
      state.outboundCreates[0].expectsReply,
      null,
      "a message that never arrived must not leave a question waiting for an answer",
    );
  });

  it("refuses a body that does not fit one segment before it reaches Twilio", async () => {
    const result = await sendPolicySms({
      studentId: STUDENT,
      templateKey: "weekly_jobs",
      body: `SPOKES: ${"x".repeat(200)} Reply STOP to stop.`,
      now: MIDMORNING,
    });
    assert.equal(result.status, "refused");
    assert.equal(state.smsCalls.length, 0);
  });

  it("refuses a body that does not name SPOKES or carry the opt-out line", async () => {
    for (const body of ["3 new jobs. Reply STOP to stop.", "SPOKES: 3 new jobs near you."]) {
      const result = await sendPolicySms({
        studentId: STUDENT,
        templateKey: "weekly_jobs",
        body,
        now: MIDMORNING,
      });
      assert.equal(result.status, "refused", body);
    }
    assert.equal(state.smsCalls.length, 0);
  });

  it("does dry runs without touching Twilio or the log", async () => {
    const result = await sendPolicySms({
      studentId: STUDENT,
      templateKey: "weekly_jobs",
      body: "SPOKES: 3 new jobs near you this week. Reply Y and Sage will show them. Reply STOP to stop.",
      now: MIDMORNING,
      dryRun: true,
    });
    assert.equal(result.status, "would_send");
    assert.equal(state.smsCalls.length, 0);
    assert.equal(state.outboundCreates.length, 0);
  });
});
