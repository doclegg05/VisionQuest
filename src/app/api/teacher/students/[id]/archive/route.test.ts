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
const errorMock = mock.fn() as any;

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

const presignMock = mock.fn(async () => null as string | null) as any;
mock.module("@/lib/storage", {
  namedExports: {
    downloadFile: async () => null,
    getPresignedDownloadUrl: presignMock,
  },
});

mock.module("@/lib/student-archive", {
  namedExports: { generateStudentArchive: generateStudentArchiveMock },
});

mock.module("@/lib/logger", {
  namedExports: {
    logger: { debug: mock.fn(), info: mock.fn(), warn: warnMock, error: errorMock },
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
  presignMock.mock.resetCalls();
  presignMock.mock.mockImplementation(async () => null);
  warnMock.mock.resetCalls();
  errorMock.mock.resetCalls();

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
      audited: true,
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

  it("still returns the archive when the audit write is rejected, says so, and alerts without a student id", async () => {
    adminAuditCreateMock.mock.mockImplementation(async () => {
      throw new Error("new row violates row-level security policy");
    });

    const res = await callRoute();
    assert.equal(res.status, 200, "the zip is already uploaded; the audit failure must not 500");
    const body = (await res.json()) as { storageKey: string; audited: boolean };
    assert.equal(body.storageKey, "archives/stu-1/2026-09-02.zip");
    assert.equal(body.audited, false, "a PII export with no audit row must say so in the response");

    // Silent-gap convention: logger.error with an alert tag, never a bare warn.
    assert.equal(warnMock.mock.callCount(), 0);
    assert.equal(errorMock.mock.callCount(), 1);
    const payload = errorMock.mock.calls[0].arguments[1] as Record<string, unknown>;
    assert.equal(payload.alert, "audit_write_failed");
    const serialized = JSON.stringify(payload);
    assert.ok(!serialized.includes("stu-1"), `error payload carries a raw student id: ${serialized}`);
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

async function callDownload(key: string): Promise<Response> {
  const req = mockRequest(
    `/api/teacher/students/stu-1/archive?key=${encodeURIComponent(key)}`,
    { method: "GET" },
  );
  return route.GET(req as any, { params: Promise.resolve({ id: "stu-1" }) } as any);
}

describe("GET /api/teacher/students/:id/archive", () => {
  it("signs a presigned URL that lasts one minute, not the one-hour default", async () => {
    presignMock.mock.mockImplementation(async () => "https://storage.example/signed");
    const res = await callDownload("archives/stu-1/archive_2026-11-11_0a1b2c3d.zip");
    assert.equal(res.status, 302);
    assert.equal(presignMock.mock.callCount(), 1);
    const options = presignMock.mock.calls[0].arguments[1] as { expiresIn?: number };
    assert.equal(options.expiresIn, 60);
    assert.equal(adminAuditCreateMock.mock.callCount(), 1, "the download writes its view row");
  });

  it("still downloads an archive stored under an older, named key", async () => {
    presignMock.mock.mockImplementation(async () => "https://storage.example/signed");
    const oldKey = "archives/stu-1/Jane_Student_2026-09-02.zip";
    const res = await callDownload(oldKey);
    assert.equal(res.status, 302);
    assert.equal(presignMock.mock.calls[0].arguments[0], oldKey);
  });

  it("refuses a key outside the student's archive folder", async () => {
    const res = await callDownload("archives/stu-2/archive_2026-11-11_0a1b2c3d.zip");
    assert.equal(res.status, 400);
    assert.equal(presignMock.mock.callCount(), 0);
  });
});
