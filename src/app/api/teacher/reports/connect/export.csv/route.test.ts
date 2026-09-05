/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockTeacherSession, mockRequest } from "@/lib/test-helpers";

const session = mockTeacherSession();

const mockFetchDohsExport = mock.fn() as any;
const mockRecordStudentView = mock.fn() as any;
const mockLogAuditEvent = mock.fn() as any;

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
    badRequest: (message: string) => makeHttpError(400, message),
  },
});

mock.module("@/lib/audit", {
  namedExports: {
    recordStudentView: mockRecordStudentView,
    logAuditEvent: mockLogAuditEvent,
  },
});

mock.module("@/lib/connect/dohs-export", {
  namedExports: {
    fetchDohsExport: mockFetchDohsExport,
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

describe("GET /api/teacher/reports/connect/export.csv", () => {
  beforeEach(() => {
    mockFetchDohsExport.mock.resetCalls();
    mockRecordStudentView.mock.resetCalls();
    mockLogAuditEvent.mock.resetCalls();
    mockFetchDohsExport.mock.mockImplementation(async () => ({ rows: [], studentIds: [] }));
    mockRecordStudentView.mock.mockImplementation(async () => undefined);
    mockLogAuditEvent.mock.mockImplementation(async () => undefined);
  });

  it("streams a CSV with the right content type and filename", async () => {
    const req = mockRequest("/api/teacher/reports/connect/export.csv", { method: "GET" });
    const res = await route.GET(req as never);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="dohs-spokes-report-.*\.csv"/);
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  it("audits the export with actor, class, and row count — no student ids in the log", async () => {
    mockFetchDohsExport.mock.mockImplementation(async () => ({
      rows: [{}, {}],
      studentIds: ["student-1", "student-2"],
    }));
    const req = mockRequest("/api/teacher/reports/connect/export.csv", { method: "GET" });
    await route.GET(req as never);

    assert.equal(mockLogAuditEvent.mock.callCount(), 1);
    const [auditCall] = mockLogAuditEvent.mock.calls[0].arguments;
    assert.equal(auditCall.actorId, session.id);
    assert.equal(auditCall.metadata.rowCount, 2);
    const serialized = JSON.stringify(auditCall);
    assert.ok(!serialized.includes("student-1"), "student id leaked into the audit log");
    assert.ok(!serialized.includes("student-2"), "student id leaked into the audit log");

    assert.equal(mockRecordStudentView.mock.callCount(), 2);
  });

  it("rejects a malformed classId with 400 before calling fetchDohsExport", async () => {
    const req = mockRequest("/api/teacher/reports/connect/export.csv?classId=not-a-cuid", {
      method: "GET",
    });
    const res = await route.GET(req as never);
    assert.equal(res.status, 400);
    assert.equal(mockFetchDohsExport.mock.callCount(), 0);
  });

  it("instructor cannot export a class they do not teach — propagates the 404", async () => {
    // fetchDohsExport's real classId check is assertClassIsManaged, which
    // throws notFound (404), not forbidden (403) — this mock error must
    // match that real status.
    const classId = "clx1abcd23efgh45ijkl67mn";
    mockFetchDohsExport.mock.mockImplementationOnce(async () => {
      throw makeHttpError(404, "That class wasn't found.");
    });
    const req = mockRequest(`/api/teacher/reports/connect/export.csv?classId=${classId}`, {
      method: "GET",
    });
    const res = await route.GET(req as never);
    assert.equal(res.status, 404);
    assert.equal(mockLogAuditEvent.mock.callCount(), 0, "a refused export must not be audited as a success");
  });
});
