/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockTeacherSession, mockRequest } from "@/lib/test-helpers";

const session = mockTeacherSession();

const mockFetchConnectFunnel = mock.fn() as any;

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

mock.module("@/lib/connect/funnel", {
  namedExports: {
    fetchConnectFunnel: mockFetchConnectFunnel,
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

describe("GET /api/teacher/reports/connect", () => {
  beforeEach(() => {
    mockFetchConnectFunnel.mock.resetCalls();
    mockFetchConnectFunnel.mock.mockImplementation(async () => ({ stages: [] }));
  });

  it("returns the funnel with no filters", async () => {
    const req = mockRequest("/api/teacher/reports/connect", { method: "GET" });
    const res = await route.GET(req as never);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(mockFetchConnectFunnel.mock.callCount(), 1);
  });

  it("forwards a valid classId, employerId, from and to", async () => {
    const classId = "clx1abcd23efgh45ijkl67mn";
    const employerId = "clx1abcd23efgh45ijkl67mo";
    const req = mockRequest(
      `/api/teacher/reports/connect?classId=${classId}&employerId=${employerId}&from=2026-06-01&to=2026-06-30`,
      { method: "GET" },
    );
    const res = await route.GET(req as never);
    assert.equal(res.status, 200);
    const [, options] = mockFetchConnectFunnel.mock.calls[0]?.arguments ?? [];
    assert.equal(options?.classId, classId);
    assert.equal(options?.employerId, employerId);
    assert.equal(options?.from, "2026-06-01");
    assert.equal(options?.to, "2026-06-30");
  });

  it("rejects a malformed classId with 400 before ever calling fetchConnectFunnel", async () => {
    const req = mockRequest("/api/teacher/reports/connect?classId=not-a-cuid", { method: "GET" });
    const res = await route.GET(req as never);
    assert.equal(res.status, 400);
    assert.equal(mockFetchConnectFunnel.mock.callCount(), 0);
  });

  it("rejects a malformed date with 400", async () => {
    const req = mockRequest("/api/teacher/reports/connect?from=06-01-2026", { method: "GET" });
    const res = await route.GET(req as never);
    assert.equal(res.status, 400);
    assert.equal(mockFetchConnectFunnel.mock.callCount(), 0);
  });

  it("propagates a 403 when the instructor does not manage the requested class", async () => {
    const classId = "clx1abcd23efgh45ijkl67mn";
    mockFetchConnectFunnel.mock.mockImplementationOnce(async () => {
      throw makeHttpError(403, "You do not have access to this class.");
    });
    const req = mockRequest(`/api/teacher/reports/connect?classId=${classId}`, { method: "GET" });
    const res = await route.GET(req as never);
    assert.equal(res.status, 403);
  });
});
