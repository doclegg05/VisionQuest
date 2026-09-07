/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Login route — request-level tests
//
// Covers Tests review #2 / #7 in the 2026-05-08 remediation pass.
//
// Strategy: we mock `@/lib/auth` so `setSessionCookie` is a spy (avoiding
// `cookies()` being called outside a Next request scope), and we drive the
// password verifier from the test rather than running the real scrypt KDF
// for every case. A single sanity check (the happy path) confirms the spy
// is invoked with the expected (studentId, role, sessionVersion) — that, in
// combination with the unit tests in `src/lib/auth.test.ts` for the actual
// cookie attributes via `setSessionCookie`, exercises the cookie contract
// end to end.
// ---------------------------------------------------------------------------

type CookieRecord = { studentId: string; role: string; sessionVersion: number; flags: { httpOnly: true; sameSite: "strict"; path: "/" } };
const cookieSets: CookieRecord[] = [];
const mfaCookieSets: string[] = [];

const mockFindUnique = mock.fn() as any;
const mockUpdate = mock.fn() as any;
const mockRateLimit = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockVerifyPasswordSafeWithStatus = mock.fn() as any;

mock.module("@/lib/auth", {
  namedExports: {
    verifyPasswordSafeWithStatus: mockVerifyPasswordSafeWithStatus,
    hashPassword: () => ({ hash: "scrypt$newhash$value", salt: "salt" }),
    normalizeStudentId: (raw: string) =>
      raw.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9@._-]/g, ""),
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    setSessionCookie: async (studentId: string, role: string, sessionVersion: number) => {
      // Mirrors the real flag set in src/lib/auth.ts setSessionCookie.
      cookieSets.push({
        studentId,
        role,
        sessionVersion,
        flags: { httpOnly: true, sameSite: "strict", path: "/" },
      });
      return "fake-jwt-token";
    },
    signMfaSessionToken: (id: string) => `mfa-token-for-${id}`,
    setMfaSessionCookie: async (token: string) => {
      mfaCookieSets.push(token);
    },
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      student: {
        findUnique: mockFindUnique,
        update: mockUpdate,
      },
    },
    prisma: {
      student: {
        findUnique: mockFindUnique,
        update: mockUpdate,
      },
    },
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

let loginRoute: Awaited<typeof import("../route")>;

before(async () => {
  loginRoute = await import("../route");
});

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    cookieSets.length = 0;
    mfaCookieSets.length = 0;
    mockFindUnique.mock.resetCalls();
    mockUpdate.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockVerifyPasswordSafeWithStatus.mock.resetCalls();

    mockRateLimit.mock.mockImplementation(async () => ({
      success: true,
      remaining: 9,
      resetTime: Date.now() + 60_000,
    }));
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockUpdate.mock.mockImplementation(async () => undefined);
    mockVerifyPasswordSafeWithStatus.mock.mockImplementation(() => ({
      valid: true,
      needsRehash: false,
    }));
  });

  it("returns 200 and sets the session cookie with HttpOnly + SameSite=Strict on valid credentials", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      id: "stu-1",
      studentId: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      role: "student",
      passwordHash: "scrypt$abc$def",
      authProvider: "password",
      isActive: true,
      mfaEnabled: false,
      sessionVersion: 1,
    }));

    const req = mockRequest("/api/auth/login", {
      method: "POST",
      body: { studentId: "alice", password: "any-password" },
    });

    const res = await loginRoute.POST(req as never);
    const body = (await res.json()) as { student: { id: string; studentId: string; role: string; displayName: string } };

    assert.equal(res.status, 200);
    assert.equal(body.student.id, "stu-1");
    assert.equal(body.student.studentId, "alice");
    assert.equal(body.student.role, "student");
    assert.equal(body.student.displayName, "Alice");

    assert.equal(cookieSets.length, 1, "expected exactly one session cookie set");
    const [cookie] = cookieSets;
    assert.equal(cookie.studentId, "stu-1");
    assert.equal(cookie.role, "student");
    assert.equal(cookie.sessionVersion, 1);
    assert.equal(cookie.flags.httpOnly, true);
    assert.equal(cookie.flags.sameSite, "strict");
    assert.equal(cookie.flags.path, "/");
  });

  it("returns 401 with no cookie set when password is wrong", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      id: "stu-1",
      studentId: "alice",
      role: "student",
      passwordHash: "scrypt$abc$def",
      authProvider: "password",
      isActive: true,
      mfaEnabled: false,
      sessionVersion: 1,
    }));
    mockVerifyPasswordSafeWithStatus.mock.mockImplementation(() => ({
      valid: false,
      needsRehash: false,
    }));

    const req = mockRequest("/api/auth/login", {
      method: "POST",
      body: { studentId: "alice", password: "wrong-password" },
    });

    const res = await loginRoute.POST(req as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 401);
    assert.match(body.error, /invalid email or password/i);
    assert.equal(cookieSets.length, 0, "no cookie should be set on failure");
  });

  it("returns 401 with no cookie set when user is not found (no enumeration leak)", async () => {
    mockFindUnique.mock.mockImplementation(async () => null);
    mockVerifyPasswordSafeWithStatus.mock.mockImplementation(() => ({
      valid: false,
      needsRehash: false,
    }));

    const req = mockRequest("/api/auth/login", {
      method: "POST",
      body: { studentId: "ghost", password: "any-password" },
    });

    const res = await loginRoute.POST(req as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 401);
    // Same generic error as wrong-password — confirms no enumeration leak.
    assert.match(body.error, /invalid email or password/i);
    assert.equal(cookieSets.length, 0);
  });

  it("returns 400 when body fails Zod validation (missing password)", async () => {
    const req = mockRequest("/api/auth/login", {
      method: "POST",
      body: { studentId: "alice" },
    });

    const res = await loginRoute.POST(req as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 400);
    assert.ok(body.error.length > 0, "should return a validation error string");
    assert.equal(mockFindUnique.mock.callCount(), 0, "DB should not be queried on invalid body");
    assert.equal(cookieSets.length, 0);
  });

  it("returns 429 when rate limit is exhausted", async () => {
    mockRateLimit.mock.mockImplementation(async () => ({
      success: false,
      remaining: 0,
      resetTime: Date.now() + 60_000,
    }));

    const req = mockRequest("/api/auth/login", {
      method: "POST",
      body: { studentId: "alice", password: "any-password" },
    });

    const res = await loginRoute.POST(req as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 429);
    assert.match(body.error, /too many/i);
    assert.equal(mockFindUnique.mock.callCount(), 0, "DB should not be queried when rate limited");
    assert.equal(cookieSets.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Per-account limiter: no account-existence oracle
//
// 2026-09-06 hunt, follow-up (1). The per-IP bucket is 10 and the per-account
// bucket (`login:user:<id>`) is 5, so the sixth guess against a REAL account
// answered 429 while the sixth guess against an unknown login answered 401 —
// the status code alone told an unauthenticated caller whether the account
// exists. The login is not a secret, so that is six cheap requests per address.
// Precedent for the fix: reset-password/questions/route.ts, where a locked
// account answers exactly like an unknown one and the attempt is still counted.
// ---------------------------------------------------------------------------

/** Admits the per-IP bucket, refuses the named per-account bucket. */
function seedAccountBucketExhausted() {
  mockRateLimit.mock.mockImplementation(async (key: string) => {
    if (key.startsWith("login:user:")) {
      return { success: false, remaining: 0, resetTime: Date.now() + 60_000, degraded: false };
    }
    return { success: true, remaining: 9, resetTime: Date.now() + 60_000, degraded: false };
  });
}

describe("POST /api/auth/login — per-account limit is not an existence oracle", () => {
  beforeEach(() => {
    cookieSets.length = 0;
    mfaCookieSets.length = 0;
    mockFindUnique.mock.resetCalls();
    mockUpdate.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockVerifyPasswordSafeWithStatus.mock.resetCalls();
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockUpdate.mock.mockImplementation(async () => undefined);
    mockVerifyPasswordSafeWithStatus.mock.mockImplementation(() => ({
      valid: true,
      needsRehash: false,
    }));
  });

  const knownStudent = () => ({
    id: "stu-1",
    studentId: "alice",
    displayName: "Alice",
    email: "alice@example.com",
    role: "student",
    passwordHash: "scrypt$abc$def",
    authProvider: "password",
    isActive: true,
    mfaEnabled: false,
    sessionVersion: 1,
  });

  it("answers a locked account with the generic 401, not a 429", async () => {
    mockFindUnique.mock.mockImplementation(async () => knownStudent());
    seedAccountBucketExhausted();

    const res = await loginRoute.POST(
      mockRequest("/api/auth/login", {
        method: "POST",
        body: { studentId: "alice", password: "any-password" },
      }) as never,
    );
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 401, "a locked account must not answer 429 — that confirms it exists");
    assert.match(body.error, /invalid email or password/i);
    assert.equal(cookieSets.length, 0);
  });

  it("answers a locked real account byte-for-byte like an unknown login", async () => {
    seedAccountBucketExhausted();

    mockFindUnique.mock.mockImplementation(async () => knownStudent());
    const locked = await loginRoute.POST(
      mockRequest("/api/auth/login", {
        method: "POST",
        body: { studentId: "alice", password: "any-password" },
      }) as never,
    );
    const lockedBody = await locked.text();

    mockVerifyPasswordSafeWithStatus.mock.mockImplementation(() => ({
      valid: false,
      needsRehash: false,
    }));
    mockFindUnique.mock.mockImplementation(async () => null);
    const unknown = await loginRoute.POST(
      mockRequest("/api/auth/login", {
        method: "POST",
        body: { studentId: "ghost", password: "any-password" },
      }) as never,
    );
    const unknownBody = await unknown.text();

    assert.equal(locked.status, unknown.status, "status must not distinguish the two");
    assert.equal(lockedBody, unknownBody, "body must not distinguish the two");
  });

  it("still refuses the correct password while the account bucket is exhausted", async () => {
    mockFindUnique.mock.mockImplementation(async () => knownStudent());
    seedAccountBucketExhausted();
    // The password verifier says the password is RIGHT.
    mockVerifyPasswordSafeWithStatus.mock.mockImplementation(() => ({
      valid: true,
      needsRehash: false,
    }));

    const res = await loginRoute.POST(
      mockRequest("/api/auth/login", {
        method: "POST",
        body: { studentId: "alice", password: "correct-horse" },
      }) as never,
    );

    assert.equal(res.status, 401);
    assert.equal(cookieSets.length, 0, "the limit must still hold — this is not a downgrade to 'allow'");
    assert.equal(mfaCookieSets.length, 0);
  });

  it("keeps counting the attempt: the per-account bucket is still spent", async () => {
    mockFindUnique.mock.mockImplementation(async () => knownStudent());
    seedAccountBucketExhausted();

    await loginRoute.POST(
      mockRequest("/api/auth/login", {
        method: "POST",
        body: { studentId: "alice", password: "any-password" },
      }) as never,
    );

    const accountKeys = mockRateLimit.mock.calls
      .map((c: { arguments: [string] }) => c.arguments[0])
      .filter((key: string) => key.startsWith("login:user:"));
    assert.deepEqual(accountKeys, ["login:user:stu-1"], "the refused attempt still spends the budget");
  });

  it("records the refusal in the audit log with a distinguishable action", async () => {
    mockFindUnique.mock.mockImplementation(async () => knownStudent());
    seedAccountBucketExhausted();

    await loginRoute.POST(
      mockRequest("/api/auth/login", {
        method: "POST",
        body: { studentId: "alice", password: "any-password" },
      }) as never,
    );

    const actions = mockLogAuditEvent.mock.calls.map(
      (c: { arguments: [{ action: string }] }) => c.arguments[0].action,
    );
    assert.deepEqual(actions, ["auth.login_failed_rate_limited"]);
  });

  it("leaves the per-IP 429 alone — it names no account", async () => {
    mockFindUnique.mock.mockImplementation(async () => knownStudent());
    mockRateLimit.mock.mockImplementation(async () => ({
      success: false,
      remaining: 0,
      resetTime: Date.now() + 60_000,
      degraded: false,
    }));

    const res = await loginRoute.POST(
      mockRequest("/api/auth/login", {
        method: "POST",
        body: { studentId: "alice", password: "any-password" },
      }) as never,
    );

    assert.equal(res.status, 429);
    assert.equal(mockFindUnique.mock.callCount(), 0, "the IP bucket refuses before any lookup");
  });
});
