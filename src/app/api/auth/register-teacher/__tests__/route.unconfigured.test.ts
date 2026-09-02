/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to several real function signatures; test setup only. */
import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

// The route reads ADMIN_KEY and TEACHER_KEY once at import time, so the
// "not configured" branch cannot be reached from route.test.ts, which imports
// the route with both keys set. This file imports it with ADMIN_KEY deleted.

const mockFindFirst = mock.fn() as any;
const mockCreate = mock.fn() as any;
const mockUpdate = mock.fn() as any;
const cookieSets: string[] = [];

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: { student: { findFirst: mockFindFirst, create: mockCreate, update: mockUpdate } },
    prisma: { student: { findFirst: mockFindFirst, create: mockCreate, update: mockUpdate } },
  },
});
mock.module("@/lib/auth", {
  namedExports: {
    hashPassword: (password: string) => ({ hash: `scrypt$salt$hashed-${password}`, salt: "salt" }),
    invalidateSessionCache: () => undefined,
    normalizeStudentId: (raw: string) => raw.toLowerCase().replace(/[^a-z0-9@._-]/g, ""),
    normalizeEmail: (raw: string) => raw.trim().toLowerCase(),
    setSessionCookie: async (studentId: string) => {
      cookieSets.push(studentId);
      return "fake-jwt-token";
    },
  },
});
mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: async () => ({ success: true, remaining: 4, resetTime: Date.now() + 60_000 }),
  },
});
mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: async () => undefined },
});
mock.module("@/lib/logger", {
  namedExports: { logger: { error: mock.fn(), warn: mock.fn(), info: mock.fn(), debug: mock.fn() } },
});

let registerRoute: Awaited<typeof import("../route")>;
const ORIGINAL_TEACHER_KEY = process.env.TEACHER_KEY;
const ORIGINAL_ADMIN_KEY = process.env.ADMIN_KEY;

before(async () => {
  delete process.env.ADMIN_KEY;
  process.env.TEACHER_KEY = "test-teacher-key";
  registerRoute = await import("../route");
});

after(() => {
  if (ORIGINAL_TEACHER_KEY === undefined) delete process.env.TEACHER_KEY;
  else process.env.TEACHER_KEY = ORIGINAL_TEACHER_KEY;
  if (ORIGINAL_ADMIN_KEY === undefined) delete process.env.ADMIN_KEY;
  else process.env.ADMIN_KEY = ORIGINAL_ADMIN_KEY;
});

function post(body: Record<string, unknown>) {
  return registerRoute.POST(mockRequest("/api/auth/register-teacher", { method: "POST", body }) as never);
}

describe("POST /api/auth/register-teacher with ADMIN_KEY unset", () => {
  it("returns 503 for admin registration before reading the database", async () => {
    const res = await post({
      registrationKey: "any-value-at-all",
      role: "admin",
      displayName: "Alice Teacher",
      email: "alice@example.com",
      password: "fresh-password-123",
    });
    const body = (await res.json()) as { error: string };

    assert.equal(res.status, 503);
    assert.match(body.error, /admin registration is not configured/i);
    assert.equal(mockFindFirst.mock.callCount(), 0);
    assert.equal(mockUpdate.mock.callCount(), 0);
    assert.equal(cookieSets.length, 0);
  });

  it("still registers a teacher with TEACHER_KEY", async () => {
    mockFindFirst.mock.mockImplementation(async () => null);
    mockCreate.mock.mockImplementation(async () => ({
      id: "tch-1",
      studentId: "alice",
      displayName: "Alice Teacher",
      email: "alice@example.com",
      role: "teacher",
      sessionVersion: 1,
    }));

    const res = await post({
      registrationKey: "test-teacher-key",
      role: "teacher",
      displayName: "Alice Teacher",
      email: "alice@example.com",
      password: "fresh-password-123",
    });
    const body = (await res.json()) as { student: { role: string } };

    assert.equal(res.status, 200);
    assert.equal(body.student.role, "teacher");
    assert.equal(mockCreate.mock.callCount(), 1);
    assert.deepEqual(cookieSets, ["tch-1"]);
  });
});
