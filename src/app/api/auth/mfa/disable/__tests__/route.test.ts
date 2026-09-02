/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// MFA disable route — request-level tests
//
// `@/lib/api-error` is left REAL so withTeacherAuth's 401/403 gate is what
// the auth cases exercise; only its getSession dependency is stubbed.
// ---------------------------------------------------------------------------

const teacher = mockTeacherSession();

const mockGetSession = mock.fn() as any;
const mockFindUnique = mock.fn() as any;
const mockUpdate = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockRateLimit = mock.fn() as any;
const mockVerifyTotp = mock.fn() as any;

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

mock.module("@/lib/rate-limit", {
  namedExports: { rateLimit: mockRateLimit },
});

mock.module("@/lib/mfa", {
  namedExports: { verifyTotp: mockVerifyTotp },
});

let disableRoute: Awaited<typeof import("../route")>;

before(async () => {
  disableRoute = await import("../route");
});

function disableRequest(token: string) {
  return mockRequest("/api/auth/mfa/disable", { method: "POST", body: { token } });
}

function auditActions(): string[] {
  return mockLogAuditEvent.mock.calls.map(
    (call: { arguments: [{ action: string }] }) => call.arguments[0].action,
  );
}

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: teacher.id,
    studentId: teacher.studentId,
    role: teacher.role,
    mfaSecret: "enc:secret",
    mfaEnabled: true,
    mfaLastUsedCounter: 41,
    ...overrides,
  };
}

describe("POST /api/auth/mfa/disable", () => {
  beforeEach(() => {
    mockGetSession.mock.resetCalls();
    mockFindUnique.mock.resetCalls();
    mockUpdate.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockVerifyTotp.mock.resetCalls();

    mockGetSession.mock.mockImplementation(async () => teacher);
    mockFindUnique.mock.mockImplementation(async () => accountRow());
    mockUpdate.mock.mockImplementation(async () => undefined);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockRateLimit.mock.mockImplementation(async () => ({
      success: true,
      remaining: 4,
      resetTime: Date.now() + 60_000,
      degraded: false,
    }));
    mockVerifyTotp.mock.mockImplementation(() => ({ valid: true, counter: 42 }));
  });

  it("returns 401 without a session and never reads the account", async () => {
    mockGetSession.mock.mockImplementation(async () => null);

    const res = await disableRoute.POST(disableRequest("123456") as never);

    assert.equal(res.status, 401);
    assert.equal(mockRateLimit.mock.callCount(), 0);
    assert.equal(mockFindUnique.mock.callCount(), 0);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("returns 403 for a student session", async () => {
    mockGetSession.mock.mockImplementation(async () => mockStudentSession());

    const res = await disableRoute.POST(disableRequest("123456") as never);

    assert.equal(res.status, 403);
    assert.equal(mockFindUnique.mock.callCount(), 0);
  });

  it("returns 429 when the per-account limit is exhausted", async () => {
    mockRateLimit.mock.mockImplementation(async () => ({
      success: false,
      remaining: 0,
      resetTime: Date.now() + 60_000,
      degraded: false,
    }));

    const res = await disableRoute.POST(disableRequest("123456") as never);

    assert.equal(res.status, 429);
    assert.equal(mockRateLimit.mock.calls[0]?.arguments[0], `mfa-disable:${teacher.id}`);
    assert.equal(mockFindUnique.mock.callCount(), 0);
  });

  it("returns 400 when MFA is not enabled", async () => {
    mockFindUnique.mock.mockImplementation(async () => accountRow({ mfaEnabled: false }));

    const res = await disableRoute.POST(disableRequest("123456") as never);

    assert.equal(res.status, 400);
    assert.equal(mockVerifyTotp.mock.callCount(), 0);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("returns 401 and records the failure when the token is wrong", async () => {
    mockVerifyTotp.mock.mockImplementation(() => ({ valid: false, counter: null }));

    const res = await disableRoute.POST(disableRequest("123456") as never);

    assert.equal(res.status, 401);
    assert.equal(mockUpdate.mock.callCount(), 0);
    assert.deepEqual(auditActions(), ["mfa.disable_failed"]);
  });

  it("checks the token against the replay counter and clears every MFA field on success", async () => {
    const res = await disableRoute.POST(disableRequest("123456") as never);
    const body = (await res.json()) as { disabled: boolean };

    assert.equal(res.status, 200);
    assert.equal(body.disabled, true);
    assert.deepEqual(mockVerifyTotp.mock.calls[0]?.arguments, ["enc:secret", "123456", 41]);
    assert.deepEqual(mockUpdate.mock.calls[0]?.arguments[0], {
      where: { id: teacher.id },
      data: {
        mfaSecret: null,
        mfaEnabled: false,
        mfaBackupCodes: [],
        mfaVerifiedAt: null,
        mfaLastUsedCounter: null,
      },
    });
    assert.deepEqual(auditActions(), ["mfa.disabled"]);
  });
});
