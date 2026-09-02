/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { ResponseCookies } from "next/dist/server/web/spec-extension/cookies";
import { mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Reset-password route — request-level tests
//
// Covers Tests review #2 / #7 in the 2026-05-08 remediation pass, plus the
// MFA gate added for security finding F66 (2026-09-02): an emailed reset token
// must never turn into a full session on an MFA-enabled account.
//
// Strategy: `@/lib/auth` is NOT mocked. The real `setSessionCookie` and
// `setMfaSessionCookie` run against a real `ResponseCookies` jar injected
// through a `next/headers` mock, so each test reads the serialized
// `Set-Cookie` header the browser would receive instead of asking a spy
// whether it was called. `hashPassword` therefore runs the real scrypt KDF
// (~50-80ms) on the two success paths; the refusal paths never reach it.
//
// `resetPasswordSchema.password.min(12)` is the current floor in
// `src/lib/schemas.ts`.
// ---------------------------------------------------------------------------

const SESSION_COOKIE = "vq-session";
const MFA_COOKIE = "vq-mfa-challenge";
const TEST_JWT_SECRET = "0123456789abcdef0123456789abcdef";

let responseHeaders = new Headers();
let cookieJar = new ResponseCookies(responseHeaders);

function setCookieHeader(): string {
  return responseHeaders.get("set-cookie") ?? "";
}

mock.module("next/headers", {
  namedExports: {
    cookies: async () => cookieJar,
  },
});

const mockFindUnique = mock.fn() as any;
const mockTransaction = mock.fn() as any;
const mockRateLimit = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockHashPasswordReset = mock.fn() as any;
const mockLoggerInfo = mock.fn() as any;

// Spy on the password update made inside $transaction so we can assert that
// it received a hashed value rather than the raw password.
const studentUpdateCalls: { id: string; passwordHash?: string }[] = [];
const tokenMarkUsedCalls: unknown[] = [];

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      passwordResetToken: {
        findUnique: mockFindUnique,
      },
      $transaction: mockTransaction,
    },
    prisma: {
      passwordResetToken: { findUnique: mockFindUnique },
      $transaction: mockTransaction,
    },
  },
});

mock.module("@/lib/password-reset", {
  namedExports: {
    hashPasswordResetToken: mockHashPasswordReset,
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: mockRateLimit,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      debug: () => undefined,
      info: mockLoggerInfo,
      warn: () => undefined,
      error: () => undefined,
    },
  },
});

let resetPasswordRoute: Awaited<typeof import("../route")>;
let verifyMfaSessionToken: (token: string) => { sub: string; role: string; sv: number; purpose: string } | null;
let originalJwtSecret: string | undefined;

before(async () => {
  originalJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  resetPasswordRoute = await import("../route");
  ({ verifyMfaSessionToken } = await import("@/lib/auth"));
});

after(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
});

/**
 * Default $transaction stub: simulates a successful update flow. The row
 * returned by `tx.student.update` is what the route reads `mfaEnabled` from,
 * so each test picks the account shape here.
 */
function installTransaction(account: { role: string; mfaEnabled: boolean }) {
  mockTransaction.mock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    return callback({
      passwordResetToken: {
        updateMany: async (args: unknown) => {
          tokenMarkUsedCalls.push(args);
          return { count: 1 };
        },
        deleteMany: async () => ({ count: 0 }),
      },
      student: {
        update: async (args: { where: { id: string }; data: { passwordHash?: string } }) => {
          studentUpdateCalls.push({ id: args.where.id, passwordHash: args.data.passwordHash });
          return {
            id: args.where.id,
            role: account.role,
            sessionVersion: 2,
            mfaEnabled: account.mfaEnabled,
          };
        },
      },
    });
  });
}

function validResetRecord(student: { id: string; role: string }) {
  return {
    id: "rst-1",
    tokenHash: "hashed-good-token",
    usedAt: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    student: { id: student.id, role: student.role, sessionVersion: 1 },
  };
}

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    responseHeaders = new Headers();
    cookieJar = new ResponseCookies(responseHeaders);
    studentUpdateCalls.length = 0;
    tokenMarkUsedCalls.length = 0;
    mockFindUnique.mock.resetCalls();
    mockTransaction.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockHashPasswordReset.mock.resetCalls();
    mockLoggerInfo.mock.resetCalls();

    mockRateLimit.mock.mockImplementation(async () => ({
      success: true,
      remaining: 9,
      resetTime: Date.now() + 60_000,
    }));
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockHashPasswordReset.mock.mockImplementation((token: string) => `hashed-${token}`);

    installTransaction({ role: "student", mfaEnabled: false });
  });

  it("returns 200 + updates password with a hashed value and sets the session cookie when token + password are valid", async () => {
    mockFindUnique.mock.mockImplementation(async () => validResetRecord({ id: "stu-1", role: "student" }));

    const req = mockRequest("/api/auth/reset-password", {
      method: "POST",
      body: { token: "good-token", password: "fresh-password-123" },
    });

    const res = await resetPasswordRoute.POST(req as never);
    const body = (await res.json()) as { ok: boolean; requiresMfa?: boolean };

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.requiresMfa, undefined, "non-MFA account must not be asked for a code");

    assert.equal(studentUpdateCalls.length, 1, "expected one student update");
    const [update] = studentUpdateCalls;
    assert.equal(update.id, "stu-1");
    assert.ok(update.passwordHash, "expected a passwordHash to be set");
    // Don't assert the hash value itself — only that it does not equal the raw
    // password (i.e. the route went through hashPassword before writing).
    assert.notEqual(update.passwordHash, "fresh-password-123");
    assert.match(update.passwordHash!, /^scrypt\$/, "expected scrypt-formatted hash");

    // Non-MFA account: a full session is issued, no MFA challenge.
    const setCookie = setCookieHeader();
    assert.match(setCookie, new RegExp(`(^|, )${SESSION_COOKIE}=`), "expected the session cookie to be set");
    assert.ok(!setCookie.includes(`${MFA_COOKIE}=`), "no MFA challenge cookie for a non-MFA account");
    assert.ok(cookieJar.get(SESSION_COOKIE)?.value, "session cookie carries a token");
  });

  it("sets the MFA challenge cookie and NO session cookie when the account has MFA enabled", async () => {
    mockFindUnique.mock.mockImplementation(async () => validResetRecord({ id: "stu-1", role: "teacher" }));
    installTransaction({ role: "teacher", mfaEnabled: true });

    const req = mockRequest("/api/auth/reset-password", {
      method: "POST",
      body: { token: "good-token", password: "fresh-password-123" },
    });

    const res = await resetPasswordRoute.POST(req as never);
    const body = (await res.json()) as { ok?: boolean; requiresMfa?: boolean };

    // Response shape matches the login route so the client can flip to the
    // MFA challenge.
    assert.equal(res.status, 200);
    assert.equal(body.requiresMfa, true);

    // The reset itself still completes: token consumed once, password hashed
    // and written, session version bumped by the transaction.
    assert.equal(tokenMarkUsedCalls.length, 1, "reset token must be marked used exactly once");
    assert.equal(studentUpdateCalls.length, 1, "expected one student update");
    assert.match(studentUpdateCalls[0].passwordHash!, /^scrypt\$/, "expected scrypt-formatted hash");

    // The serialized Set-Cookie header must carry the MFA challenge cookie
    // and must not carry the session cookie, by name.
    const setCookie = setCookieHeader();
    assert.ok(!setCookie.includes(`${SESSION_COOKIE}=`), `session cookie must not be set; got: ${setCookie}`);
    assert.match(setCookie, new RegExp(`(^|, )${MFA_COOKIE}=`), "expected the MFA challenge cookie to be set");
    assert.equal(cookieJar.get(SESSION_COOKIE), undefined, "cookie jar must hold no session cookie");

    // Same cookie contract as login: httpOnly, strict, scoped to the
    // challenge route, five-minute lifetime.
    const mfaCookie = cookieJar.get(MFA_COOKIE);
    assert.ok(mfaCookie, "MFA challenge cookie present in the jar");
    assert.equal(mfaCookie.httpOnly, true);
    assert.equal(mfaCookie.sameSite, "strict");
    assert.equal(mfaCookie.path, "/api/auth/mfa");
    assert.equal(mfaCookie.maxAge, 5 * 60);

    // The challenge token must carry the post-bump sessionVersion, or the
    // challenge route's `student.sessionVersion !== claims.sv` check would
    // reject the code the user is about to type.
    const claims = verifyMfaSessionToken(mfaCookie.value);
    assert.ok(claims, "MFA challenge cookie holds a verifiable token");
    assert.equal(claims.sub, "stu-1");
    assert.equal(claims.role, "teacher");
    assert.equal(claims.sv, 2);
    assert.equal(claims.purpose, "mfa_challenge");

    // Audit trail records the reset and that MFA was required; the server
    // log line carries only a correlation key, never the student id.
    assert.equal(mockLogAuditEvent.mock.callCount(), 1, "one audit event for the completed reset");
    const auditInput = mockLogAuditEvent.mock.calls[0].arguments[0] as {
      action: string;
      metadata?: Record<string, unknown> | null;
    };
    assert.equal(auditInput.action, "auth.password.reset");
    assert.equal(auditInput.metadata?.mfaRequired, true);

    assert.equal(mockLoggerInfo.mock.callCount(), 1, "one server-log event for reset-completed-MFA-required");
    const [logMessage, logContext] = mockLoggerInfo.mock.calls[0].arguments as [string, Record<string, unknown>];
    assert.match(logMessage, /mfa/i);
    assert.match(String(logContext.student), /^stu_[0-9a-f]{12}$/, "log context uses studentLogKey");
    assert.ok(!JSON.stringify(logContext).includes("stu-1"), "raw student id must not reach the server log");
  });

  it("returns 400 when the reset token does not exist", async () => {
    mockFindUnique.mock.mockImplementation(async () => null);

    const req = mockRequest("/api/auth/reset-password", {
      method: "POST",
      body: { token: "bogus-token", password: "fresh-password-123" },
    });

    const res = await resetPasswordRoute.POST(req as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 400);
    assert.match(body.error, /expired|already been used/i);
    assert.equal(mockTransaction.mock.callCount(), 0, "no DB update on bad token");
    assert.equal(studentUpdateCalls.length, 0);
    assert.equal(setCookieHeader(), "", "no cookie of any kind on refusal");
  });

  it("returns 400 when the reset token is expired", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      id: "rst-1",
      tokenHash: "hashed-expired-token",
      usedAt: null,
      expiresAt: new Date(Date.now() - 60 * 1000),
      student: { id: "stu-1", role: "student", sessionVersion: 1 },
    }));

    const req = mockRequest("/api/auth/reset-password", {
      method: "POST",
      body: { token: "expired-token", password: "fresh-password-123" },
    });

    const res = await resetPasswordRoute.POST(req as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 400);
    assert.match(body.error, /expired|already been used/i);
    assert.equal(studentUpdateCalls.length, 0);
    assert.equal(setCookieHeader(), "", "no cookie of any kind on refusal");
  });

  it("returns 400 when password is too short (current min: 12 chars)", async () => {
    const req = mockRequest("/api/auth/reset-password", {
      method: "POST",
      body: { token: "good-token", password: "short" },
    });

    const res = await resetPasswordRoute.POST(req as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 400);
    assert.match(body.error, /at least 12/i);
    assert.equal(mockFindUnique.mock.callCount(), 0, "schema validation should run before DB read");
    assert.equal(studentUpdateCalls.length, 0);
    assert.equal(setCookieHeader(), "", "no cookie of any kind on refusal");
  });
});
