/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// MFA verify (finish setup) route — request-level tests
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
  namedExports: {
    verifyTotp: mockVerifyTotp,
    generateBackupCodes: () => ["deadbeef", "cafebabe"],
    hashBackupCodes: (codes: string[]) => codes.map((code) => `hash:${code}`),
  },
});

let verifyRoute: Awaited<typeof import("../route")>;

before(async () => {
  verifyRoute = await import("../route");
});

function verifyRequest(token: string) {
  return mockRequest("/api/auth/mfa/verify", { method: "POST", body: { token } });
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
    mfaEnabled: false,
    ...overrides,
  };
}

describe("POST /api/auth/mfa/verify", () => {
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

    const res = await verifyRoute.POST(verifyRequest("123456") as never);

    assert.equal(res.status, 401);
    assert.equal(mockRateLimit.mock.callCount(), 0);
    assert.equal(mockFindUnique.mock.callCount(), 0);
  });

  it("returns 403 for a student session", async () => {
    mockGetSession.mock.mockImplementation(async () => mockStudentSession());

    const res = await verifyRoute.POST(verifyRequest("123456") as never);

    assert.equal(res.status, 403);
    assert.equal(mockFindUnique.mock.callCount(), 0);
  });

  it("returns 429 when the per-account limit is exhausted, before reading the body", async () => {
    mockRateLimit.mock.mockImplementation(async () => ({
      success: false,
      remaining: 0,
      resetTime: Date.now() + 60_000,
      degraded: false,
    }));

    const res = await verifyRoute.POST(verifyRequest("123456") as never);

    assert.equal(res.status, 429);
    assert.equal(mockRateLimit.mock.calls[0]?.arguments[0], `mfa-verify:${teacher.id}`);
    assert.equal(mockFindUnique.mock.callCount(), 0);
  });

  it("returns 400 when the token is not six digits", async () => {
    const res = await verifyRoute.POST(verifyRequest("12345") as never);

    assert.equal(res.status, 400);
    assert.equal(mockFindUnique.mock.callCount(), 0);
  });

  it("returns 409 when MFA is already enabled", async () => {
    mockFindUnique.mock.mockImplementation(async () => accountRow({ mfaEnabled: true }));

    const res = await verifyRoute.POST(verifyRequest("123456") as never);

    assert.equal(res.status, 409);
    assert.equal(mockVerifyTotp.mock.callCount(), 0);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("returns 400 when setup has not been started", async () => {
    mockFindUnique.mock.mockImplementation(async () => accountRow({ mfaSecret: null }));

    const res = await verifyRoute.POST(verifyRequest("123456") as never);

    assert.equal(res.status, 400);
    assert.equal(mockVerifyTotp.mock.callCount(), 0);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("returns 401 and records the failure when the token is wrong", async () => {
    mockVerifyTotp.mock.mockImplementation(() => ({ valid: false, counter: null }));

    const res = await verifyRoute.POST(verifyRequest("123456") as never);

    assert.equal(res.status, 401);
    assert.equal(mockUpdate.mock.callCount(), 0);
    assert.deepEqual(auditActions(), ["mfa.setup_verify_failed"]);
  });

  it("enables MFA, stores hashed backup codes with the counter, and returns the plaintext codes once", async () => {
    const res = await verifyRoute.POST(verifyRequest("123456") as never);
    const body = (await res.json()) as { enabled: boolean; backupCodes: string[] };

    assert.equal(res.status, 200);
    assert.equal(body.enabled, true);
    assert.deepEqual(body.backupCodes, ["deadbeef", "cafebabe"]);

    const update = mockUpdate.mock.calls[0]?.arguments[0];
    assert.equal(update?.where?.id, teacher.id);
    assert.equal(update?.data?.mfaEnabled, true);
    assert.deepEqual(update?.data?.mfaBackupCodes, ["hash:deadbeef", "hash:cafebabe"]);
    assert.equal(update?.data?.mfaLastUsedCounter, 42);
    assert.ok(update?.data?.mfaVerifiedAt instanceof Date);
    assert.deepEqual(auditActions(), ["mfa.enabled"]);
  });
});
