/* eslint-disable @typescript-eslint/no-explicit-any -- route mocks intentionally match generated clients and Better Auth's inferred session shape. */
import assert from "node:assert/strict";
import { before, beforeEach, test, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

const getBetterSession = mock.fn() as any;
const findStudent = mock.fn() as any;
const updateAuthSession = mock.fn() as any;
const deleteAuthSession = mock.fn() as any;
const rateLimit = mock.fn() as any;
const setMfaSessionCookie = mock.fn() as any;
const setSessionCookie = mock.fn() as any;

mock.module("@/lib/better-auth", {
  namedExports: {
    auth: { api: { getSession: getBetterSession } },
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      student: { findUnique: findStudent },
      authSession: {
        updateMany: updateAuthSession,
        deleteMany: deleteAuthSession,
      },
    },
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: { rateLimit },
});

mock.module("@/lib/auth", {
  namedExports: {
    setMfaSessionCookie,
    setSessionCookie,
    signMfaSessionToken: (id: string, role: string, version: number) =>
      `mfa:${id}:${role}:${version}`,
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  for (const fn of [
    getBetterSession,
    findStudent,
    updateAuthSession,
    deleteAuthSession,
    rateLimit,
    setMfaSessionCookie,
    setSessionCookie,
  ]) {
    fn.mock.resetCalls();
  }

  rateLimit.mock.mockImplementation(async () => ({ success: true }));
  getBetterSession.mock.mockImplementation(async () => ({
    user: { id: "teacher-1" },
    session: {
      token: "better-session-1",
      sessionVersion: 4,
      mfaVerified: false,
    },
  }));
  findStudent.mock.mockImplementation(async () => ({
    id: "teacher-1",
    studentId: "teacher-login",
    displayName: "Synthetic Teacher",
    role: "teacher",
    isActive: true,
    sessionVersion: 4,
    mfaEnabled: true,
  }));
  updateAuthSession.mock.mockImplementation(async () => ({ count: 1 }));
  deleteAuthSession.mock.mockImplementation(async () => ({ count: 0 }));
  setMfaSessionCookie.mock.mockImplementation(async () => undefined);
  setSessionCookie.mock.mockImplementation(async () => undefined);
});

test("staff Better Auth handoff creates only an MFA challenge before TOTP", async () => {
  const response = await route.POST(
    mockRequest("/api/auth/better-auth/handoff", {
      method: "POST",
    }) as never,
  );
  const body = (await response.json()) as {
    requiresMfa: boolean;
    student: { id: string };
  };

  assert.equal(response.status, 200);
  assert.equal(body.requiresMfa, true);
  assert.equal(body.student.id, "teacher-1");
  assert.equal(setMfaSessionCookie.mock.callCount(), 1);
  assert.equal(setSessionCookie.mock.callCount(), 0);
  assert.deepEqual(updateAuthSession.mock.calls[0].arguments[0], {
    where: { token: "better-session-1", userId: "teacher-1" },
    data: { mfaVerified: false },
  });
});

