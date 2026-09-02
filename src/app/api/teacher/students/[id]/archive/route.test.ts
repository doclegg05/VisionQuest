/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockTeacherSession, mockRequest } from "@/lib/test-helpers";
import type { Session } from "@/lib/api-error";

// AuditLog is admin-only under RLS (audit_log_admin_only). A teacher session
// writing it through the app client is rejected, and this route used to turn
// that into a 500 after the zip had already been uploaded (review F5,
// 2026-09-01). The audit row must go through the admin client, and its
// failure must not undo a response whose real work already happened.
let currentSession: Session = mockTeacherSession();

const appAuditCreateMock = mock.fn() as any;
const adminAuditCreateMock = mock.fn() as any;
const generateStudentArchiveMock = mock.fn() as any;
const warnMock = mock.fn() as any;

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
    forbidden: (message = "Forbidden") => makeHttpError(403, message),
    notFound: (message = "Not found") => makeHttpError(404, message),
  },
});

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageStudent: async (_session: Session, id: string) => ({
      id,
      displayName: "Jane Student",
    }),
  },
});

mock.module("@/lib/db", {
  namedExports: {
    prisma: { auditLog: { create: appAuditCreateMock } },
    prismaAdmin: { auditLog: { create: adminAuditCreateMock } },
  },
});

mock.module("@/lib/storage", {
  namedExports: {
    downloadFile: async () => null,
    getPresignedDownloadUrl: async () => null,
  },
});

mock.module("@/lib/student-archive", {
  namedExports: { generateStudentArchive: generateStudentArchiveMock },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: mock.fn(), warn: warnMock, error: mock.fn() },
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  appAuditCreateMock.mock.resetCalls();
  adminAuditCreateMock.mock.resetCalls();
  generateStudentArchiveMock.mock.resetCalls();
  warnMock.mock.resetCalls();

  adminAuditCreateMock.mock.mockImplementation(async () => ({ id: "audit-1" }));
  generateStudentArchiveMock.mock.mockImplementation(async () => ({
    storageKey: "archives/stu-1/2026-09-02.zip",
    fileCount: 3,
  }));
  currentSession = mockTeacherSession();
});

async function callRoute(): Promise<Response> {
  const req = mockRequest("/api/teacher/students/stu-1/archive", { method: "POST" });
  return route.POST(req as any, { params: Promise.resolve({ id: "stu-1" }) } as any);
}

describe("POST /api/teacher/students/:id/archive", () => {
  it("writes the audit row through the admin client, never the app client", async () => {
    const res = await callRoute();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      storageKey: "archives/stu-1/2026-09-02.zip",
      fileCount: 3,
    });

    assert.equal(appAuditCreateMock.mock.callCount(), 0, "app-client AuditLog write is rejected by RLS for teachers");
    assert.equal(adminAuditCreateMock.mock.callCount(), 1);
    const data = adminAuditCreateMock.mock.calls[0].arguments[0].data;
    assert.equal(data.action, "teacher.student.archive");
    assert.equal(data.actorId, "tch-test-001");
    assert.equal(data.actorRole, "teacher");
    assert.equal(data.targetType, "student");
    assert.equal(data.targetId, "stu-1");
    assert.deepEqual(JSON.parse(data.metadata), {
      storageKey: "archives/stu-1/2026-09-02.zip",
      fileCount: 3,
    });
  });

  it("still returns the archive when the audit write is rejected, and logs no student id", async () => {
    adminAuditCreateMock.mock.mockImplementation(async () => {
      throw new Error("new row violates row-level security policy");
    });

    const res = await callRoute();
    assert.equal(res.status, 200, "the zip is already uploaded; the audit failure must not 500");
    const body = (await res.json()) as { storageKey: string };
    assert.equal(body.storageKey, "archives/stu-1/2026-09-02.zip");

    assert.equal(warnMock.mock.callCount(), 1);
    const payload = JSON.stringify(warnMock.mock.calls[0].arguments[1]);
    assert.ok(!payload.includes("stu-1"), `warn payload carries a raw student id: ${payload}`);
  });

  it("returns 500 and writes no audit row when archive generation fails", async () => {
    generateStudentArchiveMock.mock.mockImplementation(async () => {
      throw new Error("storage unavailable");
    });

    const res = await callRoute();
    assert.equal(res.status, 500);
    assert.equal(adminAuditCreateMock.mock.callCount(), 0);
    assert.equal(appAuditCreateMock.mock.callCount(), 0);
  });
});
