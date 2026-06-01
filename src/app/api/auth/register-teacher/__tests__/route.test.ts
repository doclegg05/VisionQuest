/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// register-teacher (staff registration) route — request-level tests
//
// Despite the URL/file name, this endpoint backs *both* teacher and admin
// registration via the `registerStaffSchema` (registrationKey, role, ...).
// It is actively called from `src/app/teacher-register/page.tsx`, so the
// "dead code" assumption flagged in Bundle #9 is incorrect — see the PR
// body for the verification.
//
// Covers Tests review #2 / #7 in the 2026-05-08 remediation pass.
// `registerStaffSchema.password.min(8)` is the current floor (PR #47 not
// yet merged in this worktree).
// ---------------------------------------------------------------------------

type CookieRecord = { studentId: string; role: string; sessionVersion: number };
const cookieSets: CookieRecord[] = [];

const mockFindFirst = mock.fn() as any;
const mockCreate = mock.fn() as any;
const mockUpdate = mock.fn() as any;
const mockRateLimit = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;

mock.module("@/lib/auth", {
  namedExports: {
    hashPassword: (password: string) => ({
      hash: `scrypt$salt$hashed-${password}`,
      salt: "salt",
    }),
    normalizeStudentId: (raw: string) =>
      raw.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9@._-]/g, ""),
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    setSessionCookie: async (studentId: string, role: string, sessionVersion: number) => {
      cookieSets.push({ studentId, role, sessionVersion });
      return "fake-jwt-token";
    },
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      student: {
        findFirst: mockFindFirst,
        create: mockCreate,
        update: mockUpdate,
      },
    },
    prisma: {
      student: {
        findFirst: mockFindFirst,
        create: mockCreate,
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

let registerRoute: Awaited<typeof import("../route")>;
const ORIGINAL_TEACHER_KEY = process.env.TEACHER_KEY;

before(async () => {
  // The route reads TEACHER_KEY at module-import time, so set it before the
  // import. ADMIN_KEY left unset; the suite focuses on teacher registration.
  process.env.TEACHER_KEY = "test-teacher-key";
  registerRoute = await import("../route");
});

describe("POST /api/auth/register-teacher (staff registration)", () => {
  beforeEach(() => {
    cookieSets.length = 0;
    mockFindFirst.mock.resetCalls();
    mockCreate.mock.resetCalls();
    mockUpdate.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();

    mockRateLimit.mock.mockImplementation(async () => ({
      success: true,
      remaining: 4,
      resetTime: Date.now() + 60_000,
    }));
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockUpdate.mock.mockImplementation(async () => ({
      id: "tch-1",
      studentId: "alice",
      displayName: "Alice",
      role: "teacher",
    }));
  });

  it("returns 200 + creates account + sets session cookie on valid teacher registration", async () => {
    mockFindFirst.mock.mockImplementation(async () => null);
    mockCreate.mock.mockImplementation(async () => ({
      id: "tch-1",
      studentId: "alice",
      displayName: "Alice Teacher",
      email: "alice@example.com",
      role: "teacher",
      sessionVersion: 1,
    }));

    const req = mockRequest("/api/auth/register-teacher", {
      method: "POST",
      body: {
        registrationKey: "test-teacher-key",
        role: "teacher",
        displayName: "Alice Teacher",
        email: "alice@example.com",
        password: "fresh-password-123",
      },
    });

    const res = await registerRoute.POST(req as never);
    const body = (await res.json()) as { student: { id: string; studentId: string; role: string } };

    assert.equal(res.status, 200);
    assert.equal(body.student.id, "tch-1");
    assert.equal(body.student.role, "teacher");
    assert.equal(mockCreate.mock.callCount(), 1, "expected exactly one student create");
    assert.equal(cookieSets.length, 1, "expected session cookie to be set");
    assert.equal(cookieSets[0].role, "teacher");
  });

  it("returns 409 when the email is already registered (duplicate email)", async () => {
    // Existing record with the same email but a different role path —
    // simulate "email taken" branch.
    mockFindFirst.mock.mockImplementation(async () => ({
      id: "tch-existing",
      studentId: "alice",
      email: "alice@example.com",
      role: "student",
      sessionVersion: 1,
      displayName: "Alice",
    }));

    const req = mockRequest("/api/auth/register-teacher", {
      method: "POST",
      body: {
        registrationKey: "test-teacher-key",
        role: "teacher",
        displayName: "Alice Teacher",
        email: "alice@example.com",
        password: "fresh-password-123",
      },
    });

    const res = await registerRoute.POST(req as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 409);
    assert.match(body.error, /already registered|already taken/i);
    assert.equal(mockCreate.mock.callCount(), 0);
    assert.equal(cookieSets.length, 0);
  });

  it("returns 400 when password is too short (current min: 8 chars)", async () => {
    const req = mockRequest("/api/auth/register-teacher", {
      method: "POST",
      body: {
        registrationKey: "test-teacher-key",
        role: "teacher",
        displayName: "Alice Teacher",
        email: "alice@example.com",
        password: "short",
      },
    });

    const res = await registerRoute.POST(req as never);
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 400);
    assert.match(body.error, /at least 12/i);
    assert.equal(mockFindFirst.mock.callCount(), 0, "schema validation should run before DB read");
    assert.equal(mockCreate.mock.callCount(), 0);
    assert.equal(cookieSets.length, 0);
  });

  after(() => {
    if (ORIGINAL_TEACHER_KEY === undefined) {
      delete process.env.TEACHER_KEY;
    } else {
      process.env.TEACHER_KEY = ORIGINAL_TEACHER_KEY;
    }
  });
});
