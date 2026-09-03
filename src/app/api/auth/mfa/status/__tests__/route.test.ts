/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

// ---------------------------------------------------------------------------
// MFA status route — request-level tests
//
// `@/lib/api-error` is left REAL so withTeacherAuth's 401/403 gate is what
// the auth cases exercise; only its getSession dependency is stubbed.
// ---------------------------------------------------------------------------

const teacher = mockTeacherSession();

const mockGetSession = mock.fn() as any;
const mockFindUnique = mock.fn() as any;

mock.module("@/lib/auth", {
  namedExports: { getSession: mockGetSession },
});

mock.module("@/lib/db", {
  namedExports: {
    prismaAdmin: { student: { findUnique: mockFindUnique } },
    prisma: { student: { findUnique: mockFindUnique } },
  },
});

let statusRoute: Awaited<typeof import("../route")>;

before(async () => {
  statusRoute = await import("../route");
});

describe("GET /api/auth/mfa/status", () => {
  beforeEach(() => {
    mockGetSession.mock.resetCalls();
    mockFindUnique.mock.resetCalls();

    mockGetSession.mock.mockImplementation(async () => teacher);
    mockFindUnique.mock.mockImplementation(async () => ({
      mfaEnabled: true,
      mfaVerifiedAt: new Date("2026-04-13T12:00:00.000Z"),
      mfaBackupCodes: ["hash:one", "hash:two", "hash:three"],
    }));
  });

  it("returns 401 without a session and never reads the account", async () => {
    mockGetSession.mock.mockImplementation(async () => null);

    const res = await statusRoute.GET();

    assert.equal(res.status, 401);
    assert.equal(mockFindUnique.mock.callCount(), 0);
  });

  it("returns 403 for a student session", async () => {
    mockGetSession.mock.mockImplementation(async () => mockStudentSession());

    const res = await statusRoute.GET();

    assert.equal(res.status, 403);
    assert.equal(mockFindUnique.mock.callCount(), 0);
  });

  it("returns 404 when the account row is missing", async () => {
    mockFindUnique.mock.mockImplementation(async () => null);

    const res = await statusRoute.GET();

    assert.equal(res.status, 404);
  });

  it("reads only the session's own account and reports enabled state, remaining codes, and the verified time", async () => {
    const res = await statusRoute.GET();
    const body = (await res.json()) as {
      enabled: boolean;
      backupCodesRemaining: number;
      verifiedAt: string | null;
    };

    assert.equal(res.status, 200);
    assert.deepEqual(mockFindUnique.mock.calls[0]?.arguments[0]?.where, { id: teacher.id });
    assert.deepEqual(body, {
      enabled: true,
      backupCodesRemaining: 3,
      verifiedAt: "2026-04-13T12:00:00.000Z",
    });
    // Hashes never leave the server, only their count.
    assert.doesNotMatch(JSON.stringify(body), /hash:/);
  });

  it("reports a null verified time when MFA has never been verified", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({
      mfaEnabled: false,
      mfaVerifiedAt: null,
      mfaBackupCodes: [],
    }));

    const res = await statusRoute.GET();
    const body = (await res.json()) as { enabled: boolean; backupCodesRemaining: number; verifiedAt: string | null };

    assert.equal(res.status, 200);
    assert.deepEqual(body, { enabled: false, backupCodesRemaining: 0, verifiedAt: null });
  });
});
