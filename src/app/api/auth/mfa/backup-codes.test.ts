/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockTeacherSession } from "@/lib/test-helpers";

const session = mockTeacherSession();
const mockFindUnique = mock.fn() as any;
const mockUpdate = mock.fn() as any;
const mockVerifyTotp = mock.fn() as any;
const mockGenerateBackupCodes = mock.fn() as any;
const mockHashBackupCodes = mock.fn() as any;
const mockConsumeBackupCode = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;
const mockRateLimit = mock.fn() as any;
const mockVerifyMfaSessionToken = mock.fn() as any;
const mockSetSessionCookie = mock.fn() as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withTeacherAuth:
      <Args extends unknown[]>(handler: (sessionArg: typeof session, ...args: Args) => Promise<Response>) =>
      async (...args: Args) => {
        try {
          return await handler(session, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw error;
        }
      },
    withErrorHandler:
      <Args extends unknown[]>(handler: (...args: Args) => Promise<Response>) =>
      async (...args: Args) => {
        try {
          return await handler(...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number((error as { statusCode: number }).statusCode);
            const message = error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw error;
        }
      },
    badRequest: (message: string) => makeHttpError(400, message),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: {
        findUnique: mockFindUnique,
        update: mockUpdate,
      },
    },
  },
});

mock.module("@/lib/mfa", {
  namedExports: {
    verifyTotp: mockVerifyTotp,
    generateBackupCodes: mockGenerateBackupCodes,
    hashBackupCodes: mockHashBackupCodes,
    consumeBackupCode: mockConsumeBackupCode,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

mock.module("@/lib/rate-limit", {
  namedExports: {
    rateLimit: mockRateLimit,
  },
});

mock.module("@/lib/auth", {
  namedExports: {
    verifyMfaSessionToken: mockVerifyMfaSessionToken,
    setSessionCookie: mockSetSessionCookie,
  },
});

let verifyRoute: Awaited<typeof import("./verify/route")>;
let challengeRoute: Awaited<typeof import("./challenge/route")>;
let disableRoute: Awaited<typeof import("./disable/route")>;
let backupCodesRoute: Awaited<typeof import("./backup-codes/route")>;
let statusRoute: Awaited<typeof import("./status/route")>;

before(async () => {
  verifyRoute = await import("./verify/route");
  challengeRoute = await import("./challenge/route");
  disableRoute = await import("./disable/route");
  backupCodesRoute = await import("./backup-codes/route");
  statusRoute = await import("./status/route");
});

describe("MFA backup code routes", () => {
  beforeEach(() => {
    mockFindUnique.mock.resetCalls();
    mockUpdate.mock.resetCalls();
    mockVerifyTotp.mock.resetCalls();
    mockGenerateBackupCodes.mock.resetCalls();
    mockHashBackupCodes.mock.resetCalls();
    mockConsumeBackupCode.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockRateLimit.mock.resetCalls();
    mockVerifyMfaSessionToken.mock.resetCalls();
    mockSetSessionCookie.mock.resetCalls();

    mockVerifyTotp.mock.mockImplementation(() => ({ valid: true, counter: 1 }));
    mockGenerateBackupCodes.mock.mockImplementation(() => ["deadbeef", "cafebabe"]);
    mockHashBackupCodes.mock.mockImplementation((codes: string[]) =>
      codes.map((code) => `hash:${code}`),
    );
    mockConsumeBackupCode.mock.mockImplementation(() => null);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockRateLimit.mock.mockImplementation(async () => ({ success: true }));
    mockVerifyMfaSessionToken.mock.mockImplementation(() => ({
      sub: "teacher-1",
      role: "teacher",
      sv: 1,
      purpose: "mfa_challenge",
    }));
    mockSetSessionCookie.mock.mockImplementation(async () => undefined);
    mockUpdate.mock.mockImplementation(async () => undefined);
  });

  it("stores only hashed backup codes when MFA is enabled", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      id: "teacher-1",
      studentId: "teacher",
      role: "teacher",
      mfaSecret: "encrypted-secret",
      mfaEnabled: false,
    }));

    const req = mockRequest("/api/auth/mfa/verify", {
      method: "POST",
      body: { token: "123456" },
    });

    const res = await verifyRoute.POST(req as never);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body.backupCodes, ["deadbeef", "cafebabe"]);
    assert.deepEqual(mockUpdate.mock.calls[0]?.arguments[0]?.data?.mfaBackupCodes, [
      "hash:deadbeef",
      "hash:cafebabe",
    ]);
  });

  it("accepts a valid backup code during login and consumes it", async () => {
    mockVerifyTotp.mock.mockImplementation(() => ({ valid: false, counter: null }));
    mockConsumeBackupCode.mock.mockImplementation((stored: string[], token: string) =>
      token === "deadbeef" ? stored.slice(1) : null,
    );
    mockFindUnique.mock.mockImplementation(async () => ({
      id: "teacher-1",
      studentId: "teacher",
      role: "teacher",
      sessionVersion: 1,
      isActive: true,
      mfaEnabled: true,
      mfaSecret: "encrypted-secret",
      mfaBackupCodes: ["hash:deadbeef", "hash:cafebabe"],
    }));

    const req = mockRequest("/api/auth/mfa/challenge", {
      method: "POST",
      body: {
        token: "deadbeef",
        mfaSessionToken: "challenge-token",
      },
      headers: { "x-forwarded-for": "127.0.0.1" },
    });

    const res = await challengeRoute.POST(req as never);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.backupCodeUsed, true);
    assert.equal(body.backupCodesRemaining, 1);
    assert.deepEqual(mockUpdate.mock.calls[0]?.arguments[0]?.data?.mfaBackupCodes, [
      "hash:cafebabe",
    ]);
  });

  it("rejects invalid backup codes", async () => {
    mockVerifyTotp.mock.mockImplementation(() => ({ valid: false, counter: null }));
    mockConsumeBackupCode.mock.mockImplementation(() => null);
    mockFindUnique.mock.mockImplementation(async () => ({
      id: "teacher-1",
      studentId: "teacher",
      role: "teacher",
      sessionVersion: 1,
      isActive: true,
      mfaEnabled: true,
      mfaSecret: "encrypted-secret",
      mfaBackupCodes: ["hash:deadbeef"],
    }));

    const req = mockRequest("/api/auth/mfa/challenge", {
      method: "POST",
      body: {
        token: "feedface",
        mfaSessionToken: "challenge-token",
      },
      headers: { "x-forwarded-for": "127.0.0.1" },
    });

    const res = await challengeRoute.POST(req as never);

    assert.equal(res.status, 401);
    assert.equal(mockUpdate.mock.callCount(), 0);
  });

  it("clears backup codes when MFA is disabled", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      id: "teacher-1",
      studentId: "teacher",
      role: "teacher",
      mfaSecret: "encrypted-secret",
      mfaEnabled: true,
    }));

    const req = mockRequest("/api/auth/mfa/disable", {
      method: "POST",
      body: { token: "123456" },
    });

    const res = await disableRoute.POST(req as never);

    assert.equal(res.status, 200);
    assert.deepEqual(mockUpdate.mock.calls[0]?.arguments[0]?.data?.mfaBackupCodes, []);
  });

  it("returns MFA status for the authenticated staff account", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      mfaEnabled: true,
      mfaVerifiedAt: new Date("2026-04-13T12:00:00.000Z"),
      mfaBackupCodes: ["hash:one", "hash:two", "hash:three"],
    }));

    const res = await statusRoute.GET();
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.enabled, true);
    assert.equal(body.backupCodesRemaining, 3);
    assert.equal(body.verifiedAt, "2026-04-13T12:00:00.000Z");
  });

  it("regenerates backup codes after a valid TOTP check", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      id: "teacher-1",
      studentId: "teacher",
      role: "teacher",
      mfaSecret: "encrypted-secret",
      mfaEnabled: true,
    }));

    const req = mockRequest("/api/auth/mfa/backup-codes", {
      method: "POST",
      body: { token: "123456" },
    });

    const res = await backupCodesRoute.POST(req as never);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body.backupCodes, ["deadbeef", "cafebabe"]);
    assert.equal(body.backupCodesRemaining, 2);
    assert.deepEqual(mockUpdate.mock.calls[0]?.arguments[0]?.data?.mfaBackupCodes, [
      "hash:deadbeef",
      "hash:cafebabe",
    ]);
  });
});
