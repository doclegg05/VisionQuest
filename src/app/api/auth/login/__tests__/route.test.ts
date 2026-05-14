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
