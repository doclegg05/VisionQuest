/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding accepts many signatures */
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
  /** Fixed count, or null to let the in-memory outbound table answer. */
  sentTodayCount: 0 as number | null,
  outboundCreates: [] as Array<Record<string, unknown>>,
  outboundUpdates: [] as Array<Record<string, unknown>>,
  smsCalls: [] as Array<{ to: string; body: string }>,
  smsResult: true,
  smsDelayMs: 0,
  lockKey: "stu_nudge_1",
};

/**
 * A Prisma stand-in that MODELS the advisory lock: `$transaction` callbacks
 * serialise on the key `pg_advisory_xact_lock(hashtext($1))` was called with,
 * exactly as Postgres would. Without that, a concurrency test would pass by
 * accident on JavaScript's single thread rather than because the lock works.
 */
const locks = new Map<string, Promise<unknown>>();

interface StoredOutbound {
  id: string;
  toId: string;
  status: string;
  sentAt: Date;
  templateKey: string;
  expectsReply: string | null;
  [key: string]: unknown;
}

const outbound: StoredOutbound[] = [];

const outboundDelegate = {
  count: mock.fn(async (args: { where: Record<string, any> }) => {
    if (state.sentTodayCount !== null) return state.sentTodayCount;
    const statuses: string[] = args.where.status?.in ?? [];
    return outbound.filter(
      (row) =>
        row.toId === args.where.toId &&
        statuses.includes(row.status) &&
        row.sentAt >= args.where.sentAt.gte &&
        row.sentAt < args.where.sentAt.lt,
    ).length;
  }),
  create: mock.fn(async ({ data }: { data: Record<string, unknown> }) => {
    state.outboundCreates.push(data);
    const row = { id: `om_${outbound.length + 1}`, ...data } as StoredOutbound;
    outbound.push(row);
    return row;
  }),
  update: mock.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = outbound.find((entry) => entry.id === where.id);
    if (row) Object.assign(row, data);
    state.outboundUpdates.push({ id: where.id, ...data });
    return row;
  }),
  findFirst: mock.fn(async () => null),
  findMany: mock.fn(async () => []),
  updateMany: mock.fn(async () => ({ count: 1 })),
};

const preferenceDelegate = {
  findFirst: mock.fn(async () => state.preference),
  findMany: mock.fn(async () => (state.preference ? [state.preference] : [])),
  update: mock.fn(async () => state.preference),
};

const txClient = {
  notificationPreference: preferenceDelegate,
  outboundMessage: outboundDelegate,
  $executeRaw: mock.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    void strings;
    void values;
    return 1;
  }),
};

const prismaAdmin = {
  notificationPreference: preferenceDelegate,
  outboundMessage: outboundDelegate,
  $queryRaw: mock.fn(async () => [{ rolbypassrls: true }]),
  /**
   * Serialises per lock key, the way pg_advisory_xact_lock does. The key is
   * the studentId the production code passes; the callback is queued behind
   * any callback already holding it.
   */
  $transaction: mock.fn(async (callback: (tx: typeof txClient) => Promise<unknown>) => {
    const key = state.lockKey;
    const previous = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(key, previous.then(() => held));
    await previous;
    try {
      return await callback(txClient);
    } finally {
      release();
    }
  }),
};

mock.module("@/lib/db", { namedExports: { prismaAdmin, prisma: prismaAdmin } });
mock.module("@/lib/sms", {
  namedExports: {
    sendSms: mock.fn(async (to: string, body: string) => {
      state.smsCalls.push({ to, body });
      if (state.smsDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.smsDelayMs));
      }
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
  state.outboundUpdates = [];
  state.smsCalls = [];
  state.smsResult = true;
  state.smsDelayMs = 0;
  state.lockKey = STUDENT;
  outbound.length = 0;
  locks.clear();
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
    assert.equal(row.connectionId, "con_1");
    // Reserved as `queued`, then confirmed by the update after Twilio answers.
    assert.equal(row.status, "queued");
    assert.equal(row.expectsReply, null, "the question is only opened once it arrives");
    assert.equal(state.outboundUpdates.length, 1);
    assert.equal(state.outboundUpdates[0].status, "sent");
    assert.equal(state.outboundUpdates[0].expectsReply, "retention:con_1:30");
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
    const lastCall = outboundDelegate.count.mock.calls.at(-1);
    assert.ok(lastCall, "the cap was never counted");
    const countArgs = lastCall.arguments[0] as unknown as {
      where: {
        sentAt: { gte: Date; lt: Date };
        toId: string;
        channel: string;
        toKind: string;
        status: { in: string[] };
      };
    };
    // 2026-09-08 00:00 EDT = 04:00Z, and the window ends at the next local midnight.
    assert.equal(countArgs.where.sentAt.gte.toISOString(), "2026-09-08T04:00:00.000Z");
    assert.equal(countArgs.where.sentAt.lt.toISOString(), "2026-09-09T04:00:00.000Z");
    assert.equal(countArgs.where.toId, STUDENT);
    assert.equal(countArgs.where.channel, "sms");
    assert.equal(countArgs.where.toKind, "student");
    // A failed attempt was still billed by Twilio and still consumed the
    // recipient's attention; a `queued` row is a live reservation.
    assert.deepEqual(countArgs.where.status.in, ["sent", "queued", "failed"]);
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
    assert.equal(state.outboundUpdates[0].status, "failed");
    assert.equal(
      state.outboundUpdates[0].expectsReply,
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
      body: "SPOKES: 3 new jobs near you this week. Reply Y to see them on your Career page. Reply STOP to stop.",
      now: MIDMORNING,
      dryRun: true,
    });
    assert.equal(result.status, "would_send");
    assert.equal(state.smsCalls.length, 0);
    assert.equal(state.outboundCreates.length, 0);
  });

  it("never throws — an unexpected database failure becomes a value", async () => {
    preferenceDelegate.findFirst.mock.mockImplementationOnce(async () => {
      throw new Error("connection terminated");
    });
    const result = await sendPolicySms({
      studentId: STUDENT,
      templateKey: "weekly_jobs",
      body: "SPOKES: 3 new jobs near you this week. Reply Y to see them on your Career page. Reply STOP to stop.",
      now: MIDMORNING,
    });
    assert.deepEqual(result, { status: "refused", reason: "send_error" });
  });
});

describe("the daily cap under concurrency", () => {
  beforeEach(reset);

  const body =
    "SPOKES: 3 new jobs near you this week. Reply Y to see them on your Career page. Reply STOP to stop.";

  it("two overlapping sends cannot both slip past the last cap slot", async () => {
    // The reason the reservation exists. As a read-then-write, both callers
    // read "1 sent today", both decided "allowed", and the recipient got three
    // texts in a day the policy caps at two.
    state.sentTodayCount = null; // let the in-memory table answer
    outbound.push({
      id: "om_seed",
      toId: STUDENT,
      status: "sent",
      sentAt: new Date("2026-09-08T13:00:00Z"),
      templateKey: "seed",
      expectsReply: null,
    });
    state.smsDelayMs = 5; // hold the send open so the two genuinely overlap

    const results = await Promise.all([
      sendPolicySms({ studentId: STUDENT, templateKey: "a", body, now: MIDMORNING }),
      sendPolicySms({ studentId: STUDENT, templateKey: "b", body, now: MIDMORNING }),
    ]);

    const sent = results.filter((result) => result.status === "sent");
    const deferred = results.filter((result) => result.status === "deferred");
    assert.equal(sent.length, 1, `expected exactly one send, got ${JSON.stringify(results)}`);
    assert.equal(deferred.length, 1);
    assert.equal(deferred[0].status === "deferred" && deferred[0].reason, SMS_REFUSAL.dailyCap);
    assert.equal(state.smsCalls.length, 1, "only one message reached Twilio");
  });

  it("serialises on the recipient, so the second call sees the first's reservation", async () => {
    state.sentTodayCount = null;
    state.smsDelayMs = 5;
    await Promise.all([
      sendPolicySms({ studentId: STUDENT, templateKey: "a", body, now: MIDMORNING }),
      sendPolicySms({ studentId: STUDENT, templateKey: "b", body, now: MIDMORNING }),
      sendPolicySms({ studentId: STUDENT, templateKey: "c", body, now: MIDMORNING }),
    ]);
    assert.equal(state.smsCalls.length, SMS_DAILY_CAP, "the cap held under three at once");
  });
});
