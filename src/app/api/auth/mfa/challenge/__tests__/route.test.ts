/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";
import { studentLogKey } from "@/lib/log-keys";
import { generateMfaSecret, hashBackupCodes } from "@/lib/mfa";

// ---------------------------------------------------------------------------
// MFA challenge route — request-level tests
//
// `@/lib/mfa` and `@/lib/api-error` are REAL: the TOTP check and the
// backup-code claim are what these tests exercise. `@/lib/auth` is stubbed so
// the cookie helpers never call `cookies()` outside a request scope, and
// `@/lib/db` is one in-memory Student row whose `updateMany` honours the
// conditional `where` the way Postgres does (affected-row count 0 on a
// mismatch). That fake is what lets the "posted twice at once" case tell a
// conditional write apart from a read-modify-write.
// ---------------------------------------------------------------------------

const STUDENT = { id: "tch-1", studentId: "teacher", role: "teacher", sessionVersion: 3 };
const CLAIMS = {
  sub: STUDENT.id,
  role: STUDENT.role,
  sv: STUDENT.sessionVersion,
  purpose: "mfa_challenge" as const,
};
const IP = "203.0.113.9";
const BACKUP_CODES = ["deadbeef", "cafebabe"];
const { secret: TOTP_SECRET, encrypted: ENCRYPTED_SECRET } = generateMfaSecret();

interface StudentRow {
  id: string;
  studentId: string;
  role: string;
  sessionVersion: number;
  isActive: boolean;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  mfaBackupCodes: string[];
  mfaLastUsedCounter: number | null;
  mfaVerifiedAt: Date | null;
}

type LimiterResult = { success: boolean; remaining: number; resetTime: number; degraded: boolean };

const cookieSets: { studentId: string; role: string; sessionVersion: number }[] = [];
const mfaCookieClears: number[] = [];

const mockFindUnique = mock.fn() as any;
const mockUpdate = mock.fn() as any;
const mockUpdateMany = mock.fn() as any;
const mockRateLimit = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockVerifyMfaSessionToken = mock.fn() as any;
const mockGetMfaSessionToken = mock.fn() as any;
const mockLoggerWarn = mock.fn() as any;

mock.module("@/lib/auth", {
  namedExports: {
    getSession: async () => null,
    verifyMfaSessionToken: mockVerifyMfaSessionToken,
    getMfaSessionToken: mockGetMfaSessionToken,
    setSessionCookie: async (studentId: string, role: string, sessionVersion: number) => {
      cookieSets.push({ studentId, role, sessionVersion });
      return "fake-jwt-token";
    },
    clearMfaSessionCookie: async () => {
      mfaCookieClears.push(1);
    },
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      student: { findUnique: mockFindUnique, update: mockUpdate, updateMany: mockUpdateMany },
    },
    prisma: {
      student: { findUnique: mockFindUnique, update: mockUpdate, updateMany: mockUpdateMany },
    },
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: { rateLimit: mockRateLimit },
});

mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: mockLogAuditEvent },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: mockLoggerWarn,
      error: () => undefined,
    },
    requestId: () => "test-request",
  },
});

let challengeRoute: Awaited<typeof import("../route")>;

before(async () => {
  challengeRoute = await import("../route");
});

// --- Helpers ---------------------------------------------------------------

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Independent RFC 4648 decoder so the TOTP codes below are computed without
 *  reaching into the module under test. */
function base32ToBuffer(encoded: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of encoded.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238 code for the current 30-second step, shifted by `stepOffset`. */
function totpFor(secret: string, stepOffset = 0): { code: string; counter: number } {
  const counter = Math.floor(Date.now() / 1000 / 30) + stepOffset;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32ToBuffer(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return { code: code.toString().padStart(6, "0"), counter };
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function makeRow(overrides: Partial<StudentRow> = {}): StudentRow {
  return {
    id: STUDENT.id,
    studentId: STUDENT.studentId,
    role: STUDENT.role,
    sessionVersion: STUDENT.sessionVersion,
    isActive: true,
    mfaEnabled: true,
    mfaSecret: ENCRYPTED_SECRET,
    mfaBackupCodes: hashBackupCodes(BACKUP_CODES),
    mfaLastUsedCounter: null,
    mfaVerifiedAt: null,
    ...overrides,
  };
}

/**
 * Install one Student row behind the Prisma mocks. `update` is the
 * unconditional write Prisma performs for `student.update`; `updateMany`
 * applies its `where` before writing and reports the affected-row count, as
 * Postgres does. `readBarrier` lets a test hold every reader until all of
 * them have read, which forces the interleaving a race depends on.
 */
function installStudentStore(
  initial: StudentRow,
  options: { readBarrier?: () => Promise<void> } = {},
) {
  let row = initial;

  mockFindUnique.mock.mockImplementation(async () => {
    const snapshot = { ...row, mfaBackupCodes: [...row.mfaBackupCodes] };
    await options.readBarrier?.();
    return snapshot;
  });
  mockUpdate.mock.mockImplementation(async (args: { data: Partial<StudentRow> }) => {
    row = { ...row, ...args.data };
    return row;
  });
  mockUpdateMany.mock.mockImplementation(
    async (args: {
      where: { id: string; mfaBackupCodes?: { equals: string[] }; mfaLastUsedCounter?: number | null };
      data: Partial<StudentRow>;
    }) => {
      const expectedCodes = args.where.mfaBackupCodes?.equals;
      const codesMatch = expectedCodes === undefined || sameList(expectedCodes, row.mfaBackupCodes);
      // An absent key is no condition; `null` means IS NULL, as in Prisma.
      const counterMatch =
        !("mfaLastUsedCounter" in args.where) ||
        args.where.mfaLastUsedCounter === row.mfaLastUsedCounter;
      if (args.where.id !== row.id || !codesMatch || !counterMatch) return { count: 0 };
      row = { ...row, ...args.data };
      return { count: 1 };
    },
  );

  return { current: () => row };
}

/** Resolves every caller only once `size` callers have arrived. */
function latch(size: number): () => Promise<void> {
  const arrivals: number[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals.push(1);
    if (arrivals.length >= size) release();
    await gate;
  };
}

function okLimit(): LimiterResult {
  return { success: true, remaining: 4, resetTime: Date.now() + 60_000, degraded: false };
}

function blockedLimit(): LimiterResult {
  return { success: false, remaining: 0, resetTime: Date.now() + 60_000, degraded: false };
}

function blockLimiterWhen(predicate: (key: string) => boolean) {
  mockRateLimit.mock.mockImplementation(async (key: string) =>
    predicate(key) ? blockedLimit() : okLimit(),
  );
}

function limiterKeys(): string[] {
  return mockRateLimit.mock.calls.map((call: { arguments: [string] }) => call.arguments[0]);
}

function challengeRequest(token: string, options: { withSessionToken?: boolean } = {}) {
  const { withSessionToken = true } = options;
  return mockRequest("/api/auth/mfa/challenge", {
    method: "POST",
    body: withSessionToken ? { token, mfaSessionToken: "challenge-token" } : { token },
    headers: { "x-forwarded-for": IP },
  });
}

function auditActions(): string[] {
  return mockLogAuditEvent.mock.calls.map(
    (call: { arguments: [{ action: string }] }) => call.arguments[0].action,
  );
}

// --- Tests -----------------------------------------------------------------

describe("POST /api/auth/mfa/challenge", () => {
  beforeEach(() => {
    cookieSets.length = 0;
    mfaCookieClears.length = 0;
    mockFindUnique.mock.resetCalls();
    mockUpdate.mock.resetCalls();
    mockUpdateMany.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockVerifyMfaSessionToken.mock.resetCalls();
    mockGetMfaSessionToken.mock.resetCalls();
    mockLoggerWarn.mock.resetCalls();

    mockRateLimit.mock.mockImplementation(async () => okLimit());
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockVerifyMfaSessionToken.mock.mockImplementation(() => CLAIMS);
    mockGetMfaSessionToken.mock.mockImplementation(async () => null);
    installStudentStore(makeRow());
  });

  it("returns 401 when no MFA session token is present and never reads the account", async () => {
    const res = await challengeRoute.POST(challengeRequest("123456", { withSessionToken: false }) as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 401);
    assert.match(body.error, /log in again/i);
    assert.equal(mockFindUnique.mock.callCount(), 0);
    assert.deepEqual(limiterKeys(), [`mfa-challenge:${IP}`]);
    assert.equal(cookieSets.length, 0);
  });

  it("returns 401 when the MFA session token does not verify, with no per-account limiter call", async () => {
    mockVerifyMfaSessionToken.mock.mockImplementation(() => null);

    const res = await challengeRoute.POST(challengeRequest("123456") as never);

    assert.equal(res.status, 401);
    assert.equal(mockFindUnique.mock.callCount(), 0);
    assert.deepEqual(limiterKeys(), [`mfa-challenge:${IP}`]);
  });

  it("returns 429 on the per-IP limit before the body or the account is read", async () => {
    blockLimiterWhen((key) => key === `mfa-challenge:${IP}`);

    const res = await challengeRoute.POST(challengeRequest("123456") as never);

    assert.equal(res.status, 429);
    assert.equal(mockRateLimit.mock.callCount(), 1);
    assert.equal(mockVerifyMfaSessionToken.mock.callCount(), 0);
    assert.equal(mockFindUnique.mock.callCount(), 0);
  });

  it("returns 429 in plain language once the account has used its TOTP attempts", async () => {
    blockLimiterWhen((key) => key === `mfa-challenge:user:${STUDENT.id}`);

    const res = await challengeRoute.POST(challengeRequest("123456") as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 429);
    assert.match(body.error, /too many code tries/i);
    assert.equal(mockFindUnique.mock.callCount(), 0, "the account row is not read once locked");
    assert.equal(cookieSets.length, 0);

    // Keyed on the challenged account, with login's per-user bounds.
    const accountCall = mockRateLimit.mock.calls.find(
      (call: { arguments: [string] }) => call.arguments[0] === `mfa-challenge:user:${STUDENT.id}`,
    );
    assert.deepEqual(accountCall?.arguments, [`mfa-challenge:user:${STUDENT.id}`, 5, 15 * 60 * 1000]);

    // An over-limit request writes nothing: the audit row and the warn log
    // are written once per window, when the last admitted attempt lands.
    assert.deepEqual(auditActions(), []);
    assert.equal(mockLoggerWarn.mock.callCount(), 0);
  });

  it("applies the per-account limit to backup-code attempts as well", async () => {
    blockLimiterWhen((key) => key === `mfa-challenge:user:${STUDENT.id}`);

    const res = await challengeRoute.POST(challengeRequest("deadbeef") as never);

    assert.equal(res.status, 429);
    assert.equal(mockFindUnique.mock.callCount(), 0);
    assert.equal(mockUpdateMany.mock.callCount(), 0);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("records the lockout once, when the last admitted attempt lands", async () => {
    mockRateLimit.mock.mockImplementation(async (key: string) =>
      key === `mfa-challenge:user:${STUDENT.id}`
        ? { success: true, remaining: 0, resetTime: Date.now() + 60_000, degraded: false }
        : okLimit(),
    );
    const { code } = totpFor(TOTP_SECRET, -5);

    const res = await challengeRoute.POST(challengeRequest(code) as never);

    // The last admitted attempt still runs (and fails here). The lockout row
    // is written alongside it, keyed to the account, and the server log
    // carries only the correlation key.
    assert.equal(res.status, 401);
    assert.deepEqual(auditActions(), ["mfa.challenge_locked_out", "mfa.challenge_failed"]);
    assert.equal(mockLogAuditEvent.mock.calls[0]?.arguments[0]?.targetId, STUDENT.id);
    assert.equal(mockLoggerWarn.mock.callCount(), 1);
    const [, context] = mockLoggerWarn.mock.calls[0]!.arguments as [string, Record<string, unknown>];
    assert.equal(context.student, studentLogKey(STUDENT.id));
    assert.doesNotMatch(JSON.stringify(mockLoggerWarn.mock.calls[0]!.arguments), /tch-1/);
  });

  it("issues the session on a valid TOTP code and records the counter", async () => {
    const store = installStudentStore(makeRow());
    const { code, counter } = totpFor(TOTP_SECRET);

    const res = await challengeRoute.POST(challengeRequest(code) as never);
    const body = (await res.json()) as { backupCodeUsed: boolean; backupCodesRemaining: number };

    assert.equal(res.status, 200);
    assert.equal(body.backupCodeUsed, false);
    assert.equal(body.backupCodesRemaining, 2);
    assert.deepEqual(cookieSets, [
      { studentId: STUDENT.id, role: STUDENT.role, sessionVersion: STUDENT.sessionVersion },
    ]);
    assert.equal(mfaCookieClears.length, 1);
    assert.equal(store.current().mfaLastUsedCounter, counter);
    assert.ok(store.current().mfaVerifiedAt instanceof Date);
    assert.deepEqual(auditActions(), ["mfa.challenge_success"]);

    // The counter advances by one conditional write carrying the value that
    // was read; no unconditional update remains on this path.
    assert.equal(mockUpdateMany.mock.callCount(), 1);
    assert.equal(mockUpdateMany.mock.calls[0]?.arguments[0]?.where?.mfaLastUsedCounter, null);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("rejects a replayed TOTP code", async () => {
    const { code, counter } = totpFor(TOTP_SECRET);
    installStudentStore(makeRow({ mfaLastUsedCounter: counter }));

    const res = await challengeRoute.POST(challengeRequest(code) as never);

    assert.equal(res.status, 401);
    assert.equal(cookieSets.length, 0);
    assert.deepEqual(auditActions(), ["mfa.challenge_failed"]);
  });

  it("rejects a TOTP code outside the accepted window", async () => {
    const { code } = totpFor(TOTP_SECRET, -5);

    const res = await challengeRoute.POST(challengeRequest(code) as never);

    assert.equal(res.status, 401);
    assert.equal(cookieSets.length, 0);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("accepts a TOTP code posted twice at once exactly once", async () => {
    const { code, counter } = totpFor(TOTP_SECRET);
    // Both requests read mfaLastUsedCounter before either writes, so both
    // pass verifyTotp; only the write that still sees the read value lands.
    const store = installStudentStore(makeRow(), { readBarrier: latch(2) });

    const responses = await Promise.all([
      challengeRoute.POST(challengeRequest(code) as never),
      challengeRoute.POST(challengeRequest(code) as never),
    ]);
    const statuses = responses.map((res) => res.status).sort();

    assert.deepEqual(statuses, [200, 401]);
    assert.equal(store.current().mfaLastUsedCounter, counter);
    assert.equal(cookieSets.length, 1, "exactly one session is issued");
    assert.equal(mfaCookieClears.length, 1);
  });

  it("accepts a backup code once, through a conditional write, and reports the remaining count", async () => {
    const stored = hashBackupCodes(BACKUP_CODES);
    const store = installStudentStore(makeRow({ mfaBackupCodes: stored }));

    const res = await challengeRoute.POST(challengeRequest("DEAD-BEEF") as never);
    const body = (await res.json()) as { backupCodeUsed: boolean; backupCodesRemaining: number };

    assert.equal(res.status, 200);
    assert.equal(body.backupCodeUsed, true);
    assert.equal(body.backupCodesRemaining, 1);
    assert.deepEqual(store.current().mfaBackupCodes, [stored[1]]);
    assert.deepEqual(cookieSets, [
      { studentId: STUDENT.id, role: STUDENT.role, sessionVersion: STUDENT.sessionVersion },
    ]);

    // One conditional write carrying the list that was read, no unconditional one.
    assert.equal(mockUpdateMany.mock.callCount(), 1);
    assert.deepEqual(mockUpdateMany.mock.calls[0]?.arguments[0]?.where?.mfaBackupCodes, {
      equals: stored,
    });
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("rejects a backup code that was already spent", async () => {
    const stored = hashBackupCodes(BACKUP_CODES);
    installStudentStore(makeRow({ mfaBackupCodes: [stored[1]!] }));

    const res = await challengeRoute.POST(challengeRequest("deadbeef") as never);

    assert.equal(res.status, 401);
    assert.equal(cookieSets.length, 0);
    assert.deepEqual(auditActions(), ["mfa.challenge_failed"]);
  });

  it("accepts a backup code posted twice at once exactly once", async () => {
    const stored = hashBackupCodes(BACKUP_CODES);
    // Hold both requests at the read until both have read, so each one sees
    // the code as unspent — the interleaving a read-modify-write gets wrong.
    const store = installStudentStore(makeRow({ mfaBackupCodes: stored }), {
      readBarrier: latch(2),
    });

    const responses = await Promise.all([
      challengeRoute.POST(challengeRequest("deadbeef") as never),
      challengeRoute.POST(challengeRequest("deadbeef") as never),
    ]);
    const statuses = responses.map((res) => res.status).sort();

    assert.deepEqual(statuses, [200, 401]);
    assert.deepEqual(store.current().mfaBackupCodes, [stored[1]]);
    assert.equal(cookieSets.length, 1, "exactly one session is issued");
    assert.equal(mfaCookieClears.length, 1);
  });

  it("returns 401 when the session version no longer matches the claim", async () => {
    installStudentStore(makeRow({ sessionVersion: STUDENT.sessionVersion + 1 }));
    const { code } = totpFor(TOTP_SECRET);

    const res = await challengeRoute.POST(challengeRequest(code) as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 401);
    assert.match(body.error, /log in again/i);
    assert.equal(cookieSets.length, 0);
  });

  it("returns 401 when MFA is no longer enabled on the account", async () => {
    installStudentStore(makeRow({ mfaEnabled: false }));
    const { code } = totpFor(TOTP_SECRET);

    const res = await challengeRoute.POST(challengeRequest(code) as never);

    assert.equal(res.status, 401);
    assert.equal(cookieSets.length, 0);
  });
});
