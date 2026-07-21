/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import {
  mockAdminSession,
  mockTeacherSession,
  mockStudentSession,
  mockRequest,
} from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// Zod's cuid check requires a "c"-prefixed id, matching real Student ids.
const STUDENT_ID = "cstu0000000000000000001";

// ---- Mutable "current session" swapped per test. ----
let currentSession: Session = mockAdminSession();

// ---- Mock fns for prisma + collaborators. ----
const mockStudentFindUnique = mock.fn() as any;
const mockStudentUpdate = mock.fn() as any;
const mockGenerateStudentArchive = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;

function makeHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

mock.module("@/lib/api-error", {
  namedExports: {
    // Mirrors the real withAdminAuth contract: 403 for any non-admin role.
    withAdminAuth:
      <Args extends unknown[]>(
        handler: (sessionArg: Session, ...args: Args) => Promise<Response>,
      ) =>
      async (...args: Args) => {
        if (currentSession.role !== "admin") {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }
        try {
          return await handler(currentSession, ...args);
        } catch (error) {
          if (error && typeof error === "object" && "statusCode" in error) {
            const statusCode = Number(
              (error as { statusCode: number }).statusCode,
            );
            const message =
              error instanceof Error ? error.message : "Request failed";
            return Response.json({ error: message }, { status: statusCode });
          }
          throw error;
        }
      },
    badRequest: (message: string) => makeHttpError(400, message),
    notFound: (message = "Not found") => makeHttpError(404, message),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      student: {
        findUnique: mockStudentFindUnique,
        update: mockStudentUpdate,
      },
    },
  },
});

mock.module("@/lib/student-archive", {
  namedExports: {
    generateStudentArchive: mockGenerateStudentArchive,
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    logAuditEvent: mockLogAuditEvent,
  },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  mockStudentFindUnique.mock.resetCalls();
  mockStudentUpdate.mock.resetCalls();
  mockGenerateStudentArchive.mock.resetCalls();
  mockLogAuditEvent.mock.resetCalls();

  mockStudentFindUnique.mock.mockImplementation(async () => ({
    id: STUDENT_ID,
    isActive: true,
    offboardedAt: null,
  }));
  mockStudentUpdate.mock.mockImplementation(async () => ({
    isActive: false,
    offboardedAt: new Date("2026-07-20T12:00:00.000Z"),
  }));
  mockGenerateStudentArchive.mock.mockImplementation(async () => ({
    storageKey: `archives/${STUDENT_ID}/Test_Student_2026-07-20.zip`,
    fileCount: 7,
  }));
  mockLogAuditEvent.mock.mockImplementation(async () => undefined);
  currentSession = mockAdminSession();
});

async function callRoute(
  body: unknown = {},
  id: string = STUDENT_ID,
): Promise<Response> {
  const req = mockRequest(`/api/admin/students/${id}/offboard`, {
    method: "POST",
    body,
  });
  return route.POST(req as any, {
    params: Promise.resolve({ id }),
  } as any);
}

describe("POST /api/admin/students/:id/offboard", () => {
  it("rejects a teacher session with 403", async () => {
    currentSession = mockTeacherSession();
    const res = await callRoute();
    assert.equal(res.status, 403);
    assert.equal(mockGenerateStudentArchive.mock.callCount(), 0);
    assert.equal(mockStudentUpdate.mock.callCount(), 0);
  });

  it("rejects a student session with 403", async () => {
    currentSession = mockStudentSession();
    const res = await callRoute();
    assert.equal(res.status, 403);
    assert.equal(mockStudentUpdate.mock.callCount(), 0);
  });

  it("returns 400 for a non-cuid student id", async () => {
    const res = await callRoute({}, "not-a-cuid");
    assert.equal(res.status, 400);
    assert.equal(mockGenerateStudentArchive.mock.callCount(), 0);
  });

  it("returns 400 for an invalid reason in the body", async () => {
    const res = await callRoute({ reason: "x".repeat(501) });
    assert.equal(res.status, 400);
    assert.equal(mockGenerateStudentArchive.mock.callCount(), 0);
  });

  it("returns 404 when the student does not exist", async () => {
    mockStudentFindUnique.mock.mockImplementation(async () => null);
    const res = await callRoute();
    assert.equal(res.status, 404);
    assert.equal(mockGenerateStudentArchive.mock.callCount(), 0);
    assert.equal(mockStudentUpdate.mock.callCount(), 0);
  });

  it("happy path: exports the bundle, deactivates, bumps sessionVersion, stamps offboardedAt, audits", async () => {
    const res = await callRoute({ reason: "Completed program" });
    assert.equal(res.status, 200);
    const json = await res.json();

    assert.equal(json.success, true);
    assert.equal(
      json.data.archive.storageKey,
      `archives/${STUDENT_ID}/Test_Student_2026-07-20.zip`,
    );
    assert.equal(json.data.archive.fileCount, 7);
    assert.equal(json.data.isActive, false);
    assert.equal(json.data.offboardedAt, "2026-07-20T12:00:00.000Z");

    // Archive is generated with the admin session as the actor.
    assert.equal(mockGenerateStudentArchive.mock.callCount(), 1);
    assert.deepEqual(mockGenerateStudentArchive.mock.calls[0].arguments, [
      STUDENT_ID,
      currentSession.id,
    ]);

    // One atomic UPDATE sets all three flags.
    assert.equal(mockStudentUpdate.mock.callCount(), 1);
    const updateArgs = mockStudentUpdate.mock.calls[0].arguments[0];
    assert.equal(updateArgs.where.id, STUDENT_ID);
    assert.equal(updateArgs.data.isActive, false);
    assert.deepEqual(updateArgs.data.sessionVersion, { increment: 1 });
    assert.ok(updateArgs.data.offboardedAt instanceof Date);

    // Audit event written with ids only (no display name in metadata).
    assert.equal(mockLogAuditEvent.mock.callCount(), 1);
    const auditArgs = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(auditArgs.action, "student.offboard");
    assert.equal(auditArgs.targetType, "student");
    assert.equal(auditArgs.targetId, STUDENT_ID);
    assert.equal(auditArgs.actorId, currentSession.id);
    assert.equal(auditArgs.metadata.archiveFileCount, 7);
    assert.equal(auditArgs.metadata.reason, "Completed program");
  });

  it("does not deactivate the student when archive generation fails", async () => {
    mockGenerateStudentArchive.mock.mockImplementation(async () => {
      throw new Error("storage unreachable");
    });
    const res = await callRoute();
    assert.equal(res.status, 500);
    assert.equal(mockStudentUpdate.mock.callCount(), 0);
    assert.equal(mockLogAuditEvent.mock.callCount(), 0);
  });

  it("repeat call is idempotent: no new archive, offboardedAt preserved, sessionVersion re-bumped", async () => {
    const original = new Date("2026-07-01T09:30:00.000Z");
    mockStudentFindUnique.mock.mockImplementation(async () => ({
      id: STUDENT_ID,
      isActive: false,
      offboardedAt: original,
    }));

    const res = await callRoute();
    assert.equal(res.status, 200);
    const json = await res.json();

    assert.equal(json.success, true);
    assert.equal(json.data.alreadyOffboarded, true);
    assert.equal(json.data.offboardedAt, original.toISOString());
    assert.match(String(json.data.note), /already offboarded/i);

    // No fresh export bundle on repeat.
    assert.equal(mockGenerateStudentArchive.mock.callCount(), 0);

    // Re-bump is allowed, but offboardedAt must NOT be rewritten.
    assert.equal(mockStudentUpdate.mock.callCount(), 1);
    const updateArgs = mockStudentUpdate.mock.calls[0].arguments[0];
    assert.equal(updateArgs.data.isActive, false);
    assert.deepEqual(updateArgs.data.sessionVersion, { increment: 1 });
    assert.equal("offboardedAt" in updateArgs.data, false);

    // Repeat is still audited, flagged as a no-op.
    assert.equal(mockLogAuditEvent.mock.callCount(), 1);
    const auditArgs = mockLogAuditEvent.mock.calls[0].arguments[0];
    assert.equal(auditArgs.action, "student.offboard");
    assert.equal(auditArgs.metadata.alreadyOffboarded, true);
  });
});
