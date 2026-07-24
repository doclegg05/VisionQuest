/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding intentionally loose for route harnesses */
/**
 * Sign-in maturity contract — password login security probes.
 *
 * Goal 0 instrument: asserts the mature contract. Failures against today's
 * code are the baseline Goal 1 will turn green. Do not weaken these cases
 * to make the suite pass — freeze them once Goal 0 lands.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

const cookieSets: { studentId: string; role: string; sessionVersion: number }[] = [];
const rateLimitKeys: string[] = [];

const mockFindUnique = mock.fn() as any;
const mockUpdate = mock.fn() as any;
const mockRateLimit = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockVerifyPasswordSafeWithStatus = mock.fn() as any;

mock.module("@/lib/auth", {
  namedExports: {
    verifyPasswordSafeWithStatus: mockVerifyPasswordSafeWithStatus,
    hashPassword: () => ({ hash: "scrypt$new$hash", salt: "salt" }),
    normalizeStudentId: (raw: string) =>
      raw.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9@._-]/g, ""),
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    setSessionCookie: async (studentId: string, role: string, sessionVersion: number) => {
      cookieSets.push({ studentId, role, sessionVersion });
      return "fake-jwt";
    },
    signMfaSessionToken: (id: string) => `mfa-${id}`,
    setMfaSessionCookie: async () => undefined,
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

mock.module("@/lib/logger", {
  namedExports: {
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  },
});

let loginRoute: Awaited<typeof import("../login/route")>;

before(async () => {
  loginRoute = await import("../login/route");
});

describe("sign-in maturity — password / lockout", () => {
  beforeEach(() => {
    cookieSets.length = 0;
    rateLimitKeys.length = 0;
    mockFindUnique.mock.resetCalls();
    mockUpdate.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockVerifyPasswordSafeWithStatus.mock.resetCalls();

    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockUpdate.mock.mockImplementation(async () => undefined);
    mockVerifyPasswordSafeWithStatus.mock.mockImplementation(() => ({
      valid: false,
      needsRehash: false,
    }));
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

    mockRateLimit.mock.mockImplementation(async (key: string) => {
      rateLimitKeys.push(key);
      return { success: true, remaining: 4, resetTime: Date.now() + 60_000 };
    });
  });

  it("MATURITY: applies a per-account rate limit key distinct from the IP limit", async () => {
    const req = mockRequest("/api/auth/login", {
      method: "POST",
      body: { studentId: "alice", password: "wrong" },
      headers: { "x-forwarded-for": "203.0.113.10" },
    });

    await loginRoute.POST(req as never);

    const ipKey = rateLimitKeys.find((k) => k.startsWith("login:") && !k.startsWith("login:user:"));
    const userKey = rateLimitKeys.find((k) => k.startsWith("login:user:"));
    assert.ok(ipKey, "IP login rate limit must run");
    assert.ok(userKey, "per-account login rate limit must run");
    assert.match(userKey, /login:user:stu-1/);
  });

  it("MATURITY: per-account lockout rejects even when the IP limit still allows traffic", async () => {
    mockRateLimit.mock.mockImplementation(async (key: string) => {
      rateLimitKeys.push(key);
      if (key.startsWith("login:user:")) {
        return { success: false, remaining: 0, resetTime: Date.now() + 60_000 };
      }
      return { success: true, remaining: 9, resetTime: Date.now() + 60_000 };
    });

    const req = mockRequest("/api/auth/login", {
      method: "POST",
      body: { studentId: "alice", password: "any" },
      headers: { "x-forwarded-for": "198.51.100.20" },
    });

    const res = await loginRoute.POST(req as never);
    assert.equal(res.status, 429);
    assert.equal(cookieSets.length, 0);
  });
});
