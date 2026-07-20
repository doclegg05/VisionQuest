import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockTeacherSession, mockRequest } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// P1-4: POST /api/teacher/outcomes/verify — instructor sign-off on
// self-reported Certification / Application outcomes. Coverage: classroom
// scoping (403), the verified stamp + audit trail, and idempotency.

let currentSession: Session = mockTeacherSession();

const mockCertFindUnique = mock.fn<(args: unknown) => Promise<unknown>>();
const mockCertUpdate = mock.fn<(args: {
  where: { id: string };
  data: Record<string, unknown>;
}) => Promise<unknown>>();
const mockAppFindUnique = mock.fn<(args: unknown) => Promise<unknown>>();
const mockAppUpdate = mock.fn<(args: {
  where: { id: string };
  data: Record<string, unknown>;
}) => Promise<unknown>>();
const mockAssertStaffCanManageStudent = mock.fn<(session: Session, studentId: string) => Promise<void>>();
const mockLogAuditEvent = mock.fn<(input: Record<string, unknown>) => Promise<void>>();
const mockSyncStudentAlerts = mock.fn<(studentId: string) => Promise<void>>();

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    withTeacherAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: Session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        try {
          return await handler(currentSession, ...args);
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
    forbidden: (message = "Forbidden") => makeHttpError(403, message),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      certification: {
        findUnique: mockCertFindUnique,
        update: mockCertUpdate,
      },
      application: {
        findUnique: mockAppFindUnique,
        update: mockAppUpdate,
      },
    },
  },
});

mock.module("@/lib/classroom", {
  namedExports: { assertStaffCanManageStudent: mockAssertStaffCanManageStudent },
});

mock.module("@/lib/audit", {
  namedExports: { logAuditEvent: mockLogAuditEvent },
});

mock.module("@/lib/advising", {
  namedExports: { syncStudentAlerts: mockSyncStudentAlerts },
});

let route: typeof import("./route");

before(async () => {
  route = await import("./route");
});

const CERT_ID = "cjld2cjxh0000qzrmn831i7rn";
const APP_ID = "cjld2cyuq0000t3rmniod1foy";
const STUDENT_ID = "stu-1";

function verifyRequest(body: unknown): Request {
  return mockRequest("/api/teacher/outcomes/verify", { method: "POST", body }) as never;
}

describe("POST /api/teacher/outcomes/verify", () => {
  beforeEach(() => {
    currentSession = mockTeacherSession();
    mockCertFindUnique.mock.resetCalls();
    mockCertUpdate.mock.resetCalls();
    mockAppFindUnique.mock.resetCalls();
    mockAppUpdate.mock.resetCalls();
    mockAssertStaffCanManageStudent.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockSyncStudentAlerts.mock.resetCalls();

    mockCertFindUnique.mock.mockImplementation(async () => ({
      id: CERT_ID,
      studentId: STUDENT_ID,
      certType: "ready-to-work",
    }));
    mockAppFindUnique.mock.mockImplementation(async () => ({
      id: APP_ID,
      studentId: STUDENT_ID,
      opportunityId: "opp-1",
    }));
    mockCertUpdate.mock.mockImplementation(async () => ({}));
    mockAppUpdate.mock.mockImplementation(async () => ({}));
    mockAssertStaffCanManageStudent.mock.mockImplementation(async () => undefined);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
    mockSyncStudentAlerts.mock.mockImplementation(async () => undefined);
  });

  it("returns 403 when the teacher does not manage the student", async () => {
    mockAssertStaffCanManageStudent.mock.mockImplementation(async () => {
      throw makeHttpError(403, "You do not manage this student.");
    });

    const res = await route.POST(
      verifyRequest({ targetType: "certification", targetId: CERT_ID }),
    );

    assert.equal(res.status, 403);
    assert.equal(mockCertUpdate.mock.callCount(), 0);
    assert.equal(mockLogAuditEvent.mock.callCount(), 0);
  });

  it("verifies a certification: stamps verified + verifiedBy/verifiedAt, audits, syncs alerts", async () => {
    const res = await route.POST(
      verifyRequest({ targetType: "certification", targetId: CERT_ID }),
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.verificationStatus, "verified");

    assert.equal(mockCertUpdate.mock.callCount(), 1);
    const update = mockCertUpdate.mock.calls[0].arguments[0];
    assert.deepEqual(update.where, { id: CERT_ID });
    assert.equal(update.data.verificationStatus, "verified");
    assert.equal(update.data.verifiedBy, currentSession.id);
    assert.ok(update.data.verifiedAt instanceof Date);

    assert.equal(mockLogAuditEvent.mock.callCount(), 1);
    const audit = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(audit.action, "teacher.certification.verify");
    assert.equal(audit.targetId, CERT_ID);

    // Verification re-syncs alerts so certification_unverified auto-resolves.
    assert.equal(mockSyncStudentAlerts.mock.callCount(), 1);
    assert.equal(mockSyncStudentAlerts.mock.calls[0].arguments[0], STUDENT_ID);
  });

  it("is idempotent: verifying twice succeeds and re-stamps the same state", async () => {
    const first = await route.POST(
      verifyRequest({ targetType: "certification", targetId: CERT_ID }),
    );
    const second = await route.POST(
      verifyRequest({ targetType: "certification", targetId: CERT_ID }),
    );

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(mockCertUpdate.mock.callCount(), 2);
    for (const call of mockCertUpdate.mock.calls) {
      assert.equal(call.arguments[0].data.verificationStatus, "verified");
    }
  });

  it("verifies an application and audits teacher.application.verify", async () => {
    const res = await route.POST(
      verifyRequest({ targetType: "application", targetId: APP_ID }),
    );

    assert.equal(res.status, 200);
    assert.equal(mockAppUpdate.mock.callCount(), 1);
    assert.equal(mockCertUpdate.mock.callCount(), 0);
    const audit = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(audit.action, "teacher.application.verify");
  });

  it("reverts to self_reported when verified=false and audits unverify", async () => {
    const res = await route.POST(
      verifyRequest({ targetType: "certification", targetId: CERT_ID, verified: false }),
    );
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.data.verificationStatus, "self_reported");
    const update = mockCertUpdate.mock.calls[0].arguments[0];
    assert.equal(update.data.verifiedBy, null);
    assert.equal(update.data.verifiedAt, null);
    const audit = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(audit.action, "teacher.certification.unverify");
  });

  it("returns 404 when the target does not exist", async () => {
    mockCertFindUnique.mock.mockImplementation(async () => null);

    const res = await route.POST(
      verifyRequest({ targetType: "certification", targetId: CERT_ID }),
    );

    assert.equal(res.status, 404);
    assert.equal(mockCertUpdate.mock.callCount(), 0);
  });

  it("rejects an invalid targetType with 400", async () => {
    const res = await route.POST(
      verifyRequest({ targetType: "orientation", targetId: CERT_ID }),
    );

    assert.equal(res.status, 400);
  });
});
