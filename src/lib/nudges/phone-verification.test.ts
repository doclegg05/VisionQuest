/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding accepts many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * Consent is only ever stamped by a code that came back from the handset.
 * These cases pin that: no code, wrong code and expired code all leave
 * `smsConsentAt` untouched, and only a match sets it.
 */

interface PrefRow {
  id: string;
  destination: string | null;
  smsConsentAt: Date | null;
  smsVerifyCodeHash: string | null;
  smsVerifyExpiresAt: Date | null;
}

const state = {
  pref: null as PrefRow | null,
  updates: [] as Array<Record<string, unknown>>,
  smsCalls: [] as Array<{ to: string; body: string }>,
  smsResult: true,
  rateLimitOk: true,
  rateLimitDegraded: false,
  otherStudentMatch: null as { id: string } | null,
  // Hooks that let a test run a concurrent settings change at a chosen moment.
  onSms: null as null | (() => void),
  afterRead: null as null | (() => void),
};

const preferenceDelegate = {
  findUnique: mock.fn(async () => {
    const snapshot = state.pref ? { ...state.pref } : null;
    state.afterRead?.();
    return snapshot;
  }),
  findFirst: mock.fn(async (_args: { where: Record<string, unknown> }) => state.otherStudentMatch),
  update: mock.fn(async ({ data }: any) => {
    state.updates.push(data);
    return state.pref;
  }),
  // Like the database: the write lands only if every `where` field still matches.
  updateMany: mock.fn(async ({ where, data }: any) => {
    const row = state.pref as any;
    const matches = row !== null && Object.entries(where).every(([k, v]) => row[k] === v);
    if (matches) state.updates.push(data);
    return { count: matches ? 1 : 0 };
  }),
};

mock.module("@/lib/db", {
  namedExports: {
    prisma: { notificationPreference: preferenceDelegate },
    prismaAdmin: { notificationPreference: preferenceDelegate },
  },
});
mock.module("@/lib/sms", {
  namedExports: {
    sendSms: mock.fn(async (to: string, body: string) => {
      state.smsCalls.push({ to, body });
      state.onSms?.();
      return state.smsResult;
    }),
    isSmsDeliveryConfigured: () => true,
  },
});
mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: async () => ({
      success: state.rateLimitOk,
      remaining: 2,
      resetTime: 0,
      degraded: state.rateLimitDegraded,
    }),
  },
});
mock.module("@/lib/logger", {
  namedExports: {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  },
});

let verification: typeof import("./phone-verification");

before(async () => {
  verification = await import("./phone-verification");
});

const STUDENT = "stu_1";
const PHONE = "+13045550123";
const NOW = new Date("2026-09-08T14:00:00Z");

beforeEach(() => {
  state.pref = {
    id: "pref_1",
    destination: PHONE,
    smsConsentAt: null,
    smsVerifyCodeHash: null,
    smsVerifyExpiresAt: null,
  };
  state.updates = [];
  state.smsCalls = [];
  state.smsResult = true;
  state.rateLimitOk = true;
  state.rateLimitDegraded = false;
  state.otherStudentMatch = null;
  state.onSms = null;
  state.afterRead = null;
});

describe("sending the code", () => {
  it("texts the number on file and stores only its hash", async () => {
    const result = await verification.sendVerificationCode({ studentId: STUDENT, now: NOW });
    assert.deepEqual(result, { ok: true });
    assert.equal(state.smsCalls.length, 1);
    assert.equal(state.smsCalls[0].to, PHONE);

    const code = state.smsCalls[0].body.match(/code is (\d{6})/)?.[1];
    assert.ok(code, `no code in: ${state.smsCalls[0].body}`);
    const stored = state.updates[0];
    assert.equal(stored.smsVerifyCodeHash, verification.hashVerifyCode(code, STUDENT, PHONE));
    assert.notEqual(stored.smsVerifyCodeHash, code, "the code itself is never stored");
    assert.equal(
      (stored.smsVerifyExpiresAt as Date).getTime() - NOW.getTime(),
      verification.VERIFY_CODE_TTL_MS,
    );
    assert.equal(stored.smsConsentAt, undefined, "sending a code is not consent");
  });

  it("refuses when the send limiter is exhausted, and when there is no number", async () => {
    state.rateLimitOk = false;
    assert.deepEqual(await verification.sendVerificationCode({ studentId: STUDENT, now: NOW }), {
      ok: false,
      reason: "rate_limited",
    });

    state.rateLimitOk = true;
    state.pref = { ...(state.pref as PrefRow), destination: null };
    assert.deepEqual(await verification.sendVerificationCode({ studentId: STUDENT, now: NOW }), {
      ok: false,
      reason: "no_number",
    });
    assert.equal(state.smsCalls.length, 0);
  });

  it("refuses when the limiter is DEGRADED, even though it said success", async () => {
    // A paid send to a third party's handset, with an obvious alternative
    // (try again in a minute). The login path admits a degraded limiter
    // because locking a shared classroom out is worse; here an unbounded send
    // is the failure that gets the program's number reported.
    state.rateLimitDegraded = true;
    assert.deepEqual(await verification.sendVerificationCode({ studentId: STUDENT, now: NOW }), {
      ok: false,
      reason: "rate_limited",
    });
    assert.equal(state.smsCalls.length, 0);
  });

  it("stores nothing when the text did not go out", async () => {
    state.smsResult = false;
    const result = await verification.sendVerificationCode({ studentId: STUDENT, now: NOW });
    assert.deepEqual(result, { ok: false, reason: "not_delivered" });
    assert.equal(state.updates.length, 0);
  });

  it("salts the stored hash with the student id", () => {
    // Unsalted, a million sha256s cover the whole code space, so any leaked
    // hash — a backup, a query log — is the live code. Binding it to the
    // account also stops a hash lifted from one row being replayed at another.
    const mine = verification.hashVerifyCode("123456", STUDENT, PHONE);
    const theirs = verification.hashVerifyCode("123456", "stu_2", PHONE);
    assert.notEqual(mine, theirs, "the same code must not hash alike for two students");
    assert.equal(
      mine,
      verification.hashVerifyCode("123456", STUDENT, PHONE),
      "and it is deterministic",
    );
  });

  it("keeps the message inside one segment and names SPOKES", () => {
    const body = verification.buildVerifyCodeSms("123456");
    assert.ok(body.startsWith("SPOKES: "));
    assert.ok(body.endsWith("Reply STOP to stop."));
    assert.ok(body.length <= 160);
  });
});

describe("confirming the code", () => {
  function pending(code: string, expiresInMs = verification.VERIFY_CODE_TTL_MS) {
    state.pref = {
      id: "pref_1",
      destination: PHONE,
      smsConsentAt: null,
      smsVerifyCodeHash: verification.hashVerifyCode(code, STUDENT, PHONE),
      smsVerifyExpiresAt: new Date(NOW.getTime() + expiresInMs),
    };
  }

  it("stamps consent, clears the code, and turns the channel on", async () => {
    pending("123456");
    const result = await verification.confirmVerificationCode({
      studentId: STUDENT,
      code: "123456",
      now: NOW,
    });
    assert.deepEqual(result, { ok: true });
    const written = state.updates[0];
    assert.equal((written.smsConsentAt as Date).toISOString(), NOW.toISOString());
    assert.equal(written.enabled, true);
    assert.equal(written.smsRevokedAt, null);
    assert.equal(written.smsVerifyCodeHash, null, "single use");
    assert.equal(written.smsVerifyExpiresAt, null);
  });

  it("refuses a wrong code and stamps nothing", async () => {
    pending("123456");
    const result = await verification.confirmVerificationCode({
      studentId: STUDENT,
      code: "654321",
      now: NOW,
    });
    assert.deepEqual(result, { ok: false, reason: "wrong_code" });
    assert.equal(state.updates.length, 0, "consent must not be stamped");
  });

  it("refuses an expired code", async () => {
    pending("123456", -1000);
    const result = await verification.confirmVerificationCode({
      studentId: STUDENT,
      code: "123456",
      now: NOW,
    });
    assert.deepEqual(result, { ok: false, reason: "expired" });
    assert.equal(state.updates.length, 0);
  });

  it("refuses a code that was issued for a different student", async () => {
    // The pending hash is the other student's. Salting is what makes this a
    // mismatch rather than a match: unsalted, one live code would confirm on
    // any account it was replayed into.
    state.pref = {
      id: "pref_1",
      destination: PHONE,
      smsConsentAt: null,
      smsVerifyCodeHash: verification.hashVerifyCode("123456", "stu_other", PHONE),
      smsVerifyExpiresAt: new Date(NOW.getTime() + verification.VERIFY_CODE_TTL_MS),
    };
    const result = await verification.confirmVerificationCode({
      studentId: STUDENT,
      code: "123456",
      now: NOW,
    });
    assert.deepEqual(result, { ok: false, reason: "wrong_code" });
    assert.equal(state.updates.length, 0);
  });

  it("refuses when no code was ever sent — consent cannot be self-declared", async () => {
    const result = await verification.confirmVerificationCode({
      studentId: STUDENT,
      code: "123456",
      now: NOW,
    });
    assert.deepEqual(result, { ok: false, reason: "no_pending_code" });
    assert.equal(state.updates.length, 0);
  });
});

describe("a number changed while a code is in flight", () => {
  const OTHER_PHONE = "+13045559999";

  // What PUT /api/notifications/preferences does to the row on a new number.
  function changeNumberTo(destination: string) {
    state.pref = {
      ...(state.pref as PrefRow),
      destination,
      smsConsentAt: null,
      smsVerifyCodeHash: null,
      smsVerifyExpiresAt: null,
    };
  }

  it("a code texted to the old number does not confirm the new one", async () => {
    // The number changes during the Twilio send, and the late hash write lands
    // on the row that now holds the new, never-texted number.
    state.onSms = () => changeNumberTo(OTHER_PHONE);
    await verification.sendVerificationCode({ studentId: STUDENT, now: NOW });
    assert.equal(state.smsCalls[0].to, PHONE);
    state.pref = { ...(state.pref as PrefRow), ...(state.updates[0] as Partial<PrefRow>) };
    state.updates = [];

    const code = state.smsCalls[0].body.match(/code is (\d{6})/)?.[1] ?? "";
    const result = await verification.confirmVerificationCode({ studentId: STUDENT, code, now: NOW });
    assert.equal(result.ok, false);
    assert.equal(state.updates.length, 0, "consent must not be stamped for the new number");
  });

  it("consent is not stamped if the number changes between the check and the write", async () => {
    state.pref = {
      ...(state.pref as PrefRow),
      smsVerifyCodeHash: verification.hashVerifyCode("123456", STUDENT, PHONE),
      smsVerifyExpiresAt: new Date(NOW.getTime() + verification.VERIFY_CODE_TTL_MS),
    };
    state.afterRead = () => changeNumberTo(OTHER_PHONE);
    const result = await verification.confirmVerificationCode({
      studentId: STUDENT,
      code: "123456",
      now: NOW,
    });
    assert.deepEqual(result, { ok: false, reason: "no_pending_code" });
    assert.equal(state.updates.length, 0, "consent must not be stamped for the new number");
  });
});

describe("a number already claimed by another student", () => {
  it("is refused, and the answer is a boolean that names nobody", async () => {
    state.otherStudentMatch = { id: "pref_other" };
    assert.equal(await verification.phoneNumberInUseByAnotherStudent(PHONE, STUDENT), true);

    state.otherStudentMatch = null;
    assert.equal(await verification.phoneNumberInUseByAnotherStudent(PHONE, STUDENT), false);
  });

  it("only counts a LIVE claim, so a recycled handset is reusable", async () => {
    state.otherStudentMatch = { id: "pref_other" };
    await verification.phoneNumberInUseByAnotherStudent(PHONE, STUDENT);
    const where = preferenceDelegate.findFirst.mock.calls.at(-1)?.arguments[0] as any;
    assert.equal(where.where.enabled, true);
    assert.deepEqual(where.where.smsConsentAt, { not: null });
    assert.equal(where.where.smsRevokedAt, null);
    assert.deepEqual(where.where.studentId, { not: STUDENT });
  });
});
