/* eslint-disable @typescript-eslint/no-explicit-any -- route mocks intentionally cover Prisma's broad generated signatures. */
import assert from "node:assert/strict";
import { before, beforeEach, test, mock } from "node:test";
import { mockRequest } from "@/lib/test-helpers";

const setSessionCookie = mock.fn() as any;
const getSession = mock.fn() as any;
const logAuditEvent = mock.fn() as any;
const rateLimit = mock.fn() as any;
const invitationFindUnique = mock.fn() as any;
const invitationUpdateMany = mock.fn() as any;
const invitationUpdate = mock.fn() as any;
const studentFindUnique = mock.fn() as any;
const studentUpdate = mock.fn() as any;
const studentCreate = mock.fn() as any;
const enrollmentUpsert = mock.fn() as any;

const tx = {
  classroomInvitation: {
    findUnique: invitationFindUnique,
    updateMany: invitationUpdateMany,
    update: invitationUpdate,
  },
  student: {
    findUnique: studentFindUnique,
    update: studentUpdate,
    create: studentCreate,
  },
  studentClassEnrollment: { upsert: enrollmentUpsert },
};

mock.module("@/lib/auth", {
  namedExports: {
    getSession,
    normalizeEmail: (value: string) => value.trim().toLowerCase(),
    setSessionCookie,
  },
});

mock.module("@/lib/audit", {
  namedExports: { logAuditEvent },
});

mock.module("@/lib/rate-limit", {
  namedExports: { rateLimit },
});

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: {
      $transaction: async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  for (const fn of [
    setSessionCookie,
    getSession,
    logAuditEvent,
    rateLimit,
    invitationFindUnique,
    invitationUpdateMany,
    invitationUpdate,
    studentFindUnique,
    studentUpdate,
    studentCreate,
    enrollmentUpsert,
  ]) {
    fn.mock.resetCalls();
  }

  rateLimit.mock.mockImplementation(async () => ({ success: true }));
  getSession.mock.mockImplementation(async () => null);
  invitationFindUnique.mock.mockImplementation(async () => ({
    id: "invite-1",
    email: "existing@example.test",
    classId: "class-1",
    role: "student",
    expiresAt: new Date(Date.now() + 60_000),
    redeemedAt: null,
    revokedAt: null,
  }));
  invitationUpdateMany.mock.mockImplementation(async () => ({ count: 1 }));
  studentFindUnique.mock.mockImplementation(async () => ({
    id: "existing-student",
    studentId: "existing",
    displayName: "Existing Student",
    email: "existing@example.test",
    emailVerified: false,
    role: "student",
    isActive: true,
    sessionVersion: 8,
  }));
  studentUpdate.mock.mockImplementation(async (args: any) => ({
    ...(await studentFindUnique()),
    ...args.data,
  }));
  enrollmentUpsert.mock.mockImplementation(async () => ({}));
  invitationUpdate.mock.mockImplementation(async () => ({}));
  logAuditEvent.mock.mockImplementation(async () => undefined);
  setSessionCookie.mock.mockImplementation(async () => undefined);
});

test("an invitation token cannot authenticate or mutate an existing account", async () => {
  const response = await route.POST(
    mockRequest("/api/auth/invitations/redeem", {
      method: "POST",
      body: {
        token: "a".repeat(64),
        email: "existing@example.test",
      },
    }) as never,
  );

  assert.equal(response.status, 401);
  assert.equal(setSessionCookie.mock.callCount(), 0);
  assert.equal(studentUpdate.mock.callCount(), 0);
  assert.equal(enrollmentUpsert.mock.callCount(), 0);
  assert.equal(invitationUpdateMany.mock.callCount(), 0);
});
