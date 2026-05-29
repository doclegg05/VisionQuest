/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// Reset-password route — request-level tests
//
// Covers Tests review #2 / #7 in the 2026-05-08 remediation pass.
//
// `resetPasswordSchema.password.min(8)` is the current floor in
// `src/lib/schemas.ts` (PR #47 raising it to 12 has not landed in this
// worktree). Update the boundary case below if/when that PR merges.
// ---------------------------------------------------------------------------

type CookieRecord = { studentId: string; role: string; sessionVersion: number };
const cookieSets: CookieRecord[] = [];

const mockFindUnique = mock.fn() as any;
const mockTransaction = mock.fn() as any;
const mockRateLimit = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockHashPasswordReset = mock.fn() as any;

// Spy on the password update made inside $transaction so we can assert that
// it received a hashed value rather than the raw password.
const studentUpdateCalls: { id: string; passwordHash?: string }[] = [];
const tokenMarkUsedCalls: unknown[] = [];

mock.module("@/lib/auth", {
  namedExports: {
    hashPassword: (password: string) => ({
      hash: `scrypt$salt$hashed-${password}`,
      salt: "salt",
    }),
    setSessionCookie: async (studentId: string, role: string, sessionVersion: number) => {
      cookieSets.push({ studentId, role, sessionVersion });
      return "fake-jwt-token";
    },
  },
});

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

let resetPasswordRoute: Awaited<typeof import("../route")>;

before(async () => {
  resetPasswordRoute = await import("../route");
});

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    cookieSets.length = 0;
    studentUpdateCalls.length = 0;
    tokenMarkUsedCalls.length = 0;
    mockFindUnique.mock.resetCalls();
    mockTransaction.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockHashPasswordReset.mock.resetCalls();

    mockRateLimit.mock.mockImplementation(async () => ({
      success: true,
      remaining: 9,
      resetTime: Date.now() + 60_000,
    }));
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockHashPasswordReset.mock.mockImplementation((token: string) => `hashed-${token}`);

    // Default $transaction stub: simulates a successful update flow.
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
              role: "student",
              sessionVersion: 2,
            };
          },
        },
      });
    });
  });

  it("returns 200 + updates password with a hashed value when token + password are valid", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      id: "rst-1",
      tokenHash: "hashed-good-token",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      student: { id: "stu-1", role: "student", sessionVersion: 1 },
    }));

    const req = mockRequest("/api/auth/reset-password", {
      method: "POST",
      body: { token: "good-token", password: "fresh-password-123" },
    });

    const res = await resetPasswordRoute.POST(req as never);
    const body = (await res.json()) as { ok: boolean };

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);

    assert.equal(studentUpdateCalls.length, 1, "expected one student update");
    const [update] = studentUpdateCalls;
    assert.equal(update.id, "stu-1");
    assert.ok(update.passwordHash, "expected a passwordHash to be set");
    // Don't assert the hash value itself — only that it does not equal the raw
    // password (i.e. the route went through hashPassword before writing).
    assert.notEqual(update.passwordHash, "fresh-password-123");
    assert.match(update.passwordHash!, /^scrypt\$/, "expected scrypt-formatted hash");
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
  });

  it("returns 400 when password is too short (current min: 8 chars)", async () => {
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
  });
});
