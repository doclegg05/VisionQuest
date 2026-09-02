/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// MFA setup route — request-level tests
//
// `@/lib/api-error` is left REAL so withTeacherAuth's 401/403 gate is what
// the auth cases exercise; only its getSession dependency is stubbed.
// rls-context is pure AsyncLocalStorage and needs no mock.
// ---------------------------------------------------------------------------

const teacher = mockTeacherSession();

const mockGetSession = mock.fn() as any;
const mockFindUnique = mock.fn() as any;
const mockUpdate = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;

mock.module("@/lib/auth", {
  namedExports: { getSession: mockGetSession },
});

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: { student: { findUnique: mockFindUnique, update: mockUpdate } },
    prisma: { student: { findUnique: mockFindUnique, update: mockUpdate } },
  },
});

mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: mockLogAuditEvent },
});

mock.module("@/lib/mfa", {
  namedExports: {
    generateMfaSecret: () => ({ secret: "JBSWY3DPEHPK3PXP", encrypted: "enc:JBSWY3DPEHPK3PXP" }),
    generateTotpUri: (secret: string, email: string) =>
      `otpauth://totp/VisionQuest:${encodeURIComponent(email)}?secret=${secret}`,
  },
});

let setupRoute: Awaited<typeof import("../route")>;

before(async () => {
  setupRoute = await import("../route");
});

function auditActions(): string[] {
  return mockLogAuditEvent.mock.calls.map(
    (call: { arguments: [{ action: string }] }) => call.arguments[0].action,
  );
}

describe("POST /api/auth/mfa/setup", () => {
  beforeEach(() => {
    mockGetSession.mock.resetCalls();
    mockFindUnique.mock.resetCalls();
    mockUpdate.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();

    mockGetSession.mock.mockImplementation(async () => teacher);
    mockFindUnique.mock.mockImplementation(async () => ({
      id: teacher.id,
      email: "teacher@example.com",
      mfaEnabled: false,
      studentId: teacher.studentId,
      role: teacher.role,
    }));
    mockUpdate.mock.mockImplementation(async () => undefined);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
  });

  it("returns 401 without a session and never reads the account", async () => {
    mockGetSession.mock.mockImplementation(async () => null);

    const res = await setupRoute.POST();

    assert.equal(res.status, 401);
    assert.equal(mockFindUnique.mock.callCount(), 0);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("returns 403 for a student session", async () => {
    mockGetSession.mock.mockImplementation(async () => mockStudentSession());

    const res = await setupRoute.POST();

    assert.equal(res.status, 403);
    assert.equal(mockFindUnique.mock.callCount(), 0);
  });

  it("returns 404 when the account row is missing", async () => {
    mockFindUnique.mock.mockImplementation(async () => null);

    const res = await setupRoute.POST();

    assert.equal(res.status, 404);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("returns 409 when MFA is already enabled, without touching the secret", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      id: teacher.id,
      email: "teacher@example.com",
      mfaEnabled: true,
      studentId: teacher.studentId,
      role: teacher.role,
    }));

    const res = await setupRoute.POST();

    assert.equal(res.status, 409);
    assert.equal(mockUpdate.mock.callCount(), 0);
    assert.deepEqual(auditActions(), []);
  });

  it("stores the encrypted secret provisionally and returns the TOTP URI", async () => {
    const res = await setupRoute.POST();
    const body = (await res.json()) as { totpUri: string; secret: string };

    assert.equal(res.status, 200);
    assert.equal(body.secret, "JBSWY3DPEHPK3PXP");
    assert.match(body.totpUri, /^otpauth:\/\/totp\/VisionQuest:teacher%40example\.com\?secret=JBSWY3DPEHPK3PXP$/);

    // Only the encrypted form reaches the database, and MFA stays off until verified.
    const update = mockUpdate.mock.calls[0]?.arguments[0];
    assert.deepEqual(update, { where: { id: teacher.id }, data: { mfaSecret: "enc:JBSWY3DPEHPK3PXP" } });
    assert.deepEqual(auditActions(), ["mfa.setup_started"]);
  });

  it("falls back to the login id in the TOTP URI when the account has no email", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      id: teacher.id,
      email: null,
      mfaEnabled: false,
      studentId: teacher.studentId,
      role: teacher.role,
    }));

    const res = await setupRoute.POST();
    const body = (await res.json()) as { totpUri: string };

    assert.equal(res.status, 200);
    assert.match(body.totpUri, new RegExp(`VisionQuest:${teacher.studentId}\\?`));
  });
});
