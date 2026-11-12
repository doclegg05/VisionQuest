import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Sign-in and the forced password change (readiness A3)
//
// Staff set a student's first password and every reset, so a staff member
// knows it until the student changes it. Sign-in still issues a session for
// such an account, and says on the cookie that the session is held:
// src/proxy.ts then sends its pages to the change screen and refuses its API
// calls. These tests hold the route to the answer it gives the cookie.
// ---------------------------------------------------------------------------

// The route keys the unknown-login limiter bucket on an HMAC under JWT_SECRET.
process.env.JWT_SECRET = "test-secret-for-login-route-password-change";

interface AccountRow {
  id: string;
  studentId: string;
  displayName: string;
  role: string;
  passwordHash: string | null;
  authProvider: string;
  isActive: boolean;
  mfaEnabled: boolean;
  sessionVersion: number;
  mustChangePassword: boolean;
  demoAccount: string | null;
}

let account: AccountRow;
/** The options each session cookie was issued with, in call order. */
const cookieOptions: unknown[] = [];

mock.module("@/lib/auth", {
  namedExports: {
    verifyPasswordSafeWithStatus: () => ({ valid: true, needsRehash: false }),
    hashPassword: () => ({ hash: "scrypt$newhash$value", salt: "salt" }),
    normalizeStudentId: (raw: string) => raw.toLowerCase(),
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    sessionCachePrimer: () => () => undefined,
    setSessionCookie: async (_id: string, _role: string, _sessionVersion: number, options: unknown) => {
      cookieOptions.push(options);
      return "fake-jwt-token";
    },
    signMfaSessionToken: (id: string) => `mfa-token-for-${id}`,
    setMfaSessionCookie: async () => undefined,
  },
});

const fakeDb = { student: { findUnique: async () => account, updateMany: async () => ({ count: 1 }) } };
mock.module("@/lib/db", { namedExports: { prismaAdmin: fakeDb, prisma: fakeDb } });

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: async () => ({ success: true, remaining: 4, resetTime: Date.now() + 60_000, degraded: false }),
    refundRateLimit: async () => undefined,
  },
});

mock.module("@/lib/audit", { namedExports: { logAuditEvent: async () => undefined } });

let loginRoute: Awaited<typeof import("../route")>;

before(async () => {
  loginRoute = await import("../route");
});

beforeEach(() => {
  cookieOptions.length = 0;
  account = {
    id: "stu-1",
    studentId: "alice",
    displayName: "Alice",
    role: "student",
    passwordHash: "scrypt$abc$def",
    authProvider: "password",
    isActive: true,
    mfaEnabled: false,
    sessionVersion: 1,
    mustChangePassword: false,
    demoAccount: null,
  };
});

async function signIn(): Promise<{ status: number; mustChangePassword: unknown }> {
  const res = await loginRoute.POST(
    mockRequest("/api/auth/login", { method: "POST", body: { studentId: "alice", password: "any-password" } }) as never,
  );
  const body: unknown = await res.json();
  const student = typeof body === "object" && body !== null && "student" in body ? body.student : undefined;
  const flag = typeof student === "object" && student !== null && "mustChangePassword" in student ? student.mustChangePassword : undefined;
  return { status: res.status, mustChangePassword: flag };
}

describe("POST /api/auth/login: the session it issues says whether it is held", () => {
  it("issues a held session to a student whose password staff set", async () => {
    account = { ...account, mustChangePassword: true };

    const result = await signIn();

    assert.equal(result.status, 200);
    assert.deepEqual(cookieOptions, [{ mustChangePassword: true }]);
    assert.equal(result.mustChangePassword, true);
  });

  it("issues a session that is not held when the student chose the password", async () => {
    const result = await signIn();

    assert.equal(result.status, 200);
    assert.deepEqual(cookieOptions, [{ mustChangePassword: false }]);
    assert.equal(result.mustChangePassword, false);
  });

  it("never holds a staff account, even one whose row carries the flag", async () => {
    account = { ...account, id: "tch-1", studentId: "tina", role: "teacher", mustChangePassword: true };

    const result = await signIn();

    assert.equal(result.status, 200);
    assert.deepEqual(cookieOptions, [{ mustChangePassword: false }]);
    assert.equal(result.mustChangePassword, false);
  });
});
