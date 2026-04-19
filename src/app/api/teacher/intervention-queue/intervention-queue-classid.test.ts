/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockTeacherSession, mockRequest } from "@/lib/test-helpers";

const session = mockTeacherSession();

const mockAssertStaffCanManageClass = mock.fn() as any;
const mockGetInterventionQueue = mock.fn() as any;

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

mock.module("@/lib/classroom", {
  namedExports: {
    assertStaffCanManageClass: mockAssertStaffCanManageClass,
  },
});

mock.module("@/lib/teacher/dashboard", {
  namedExports: {
    getInterventionQueue: mockGetInterventionQueue,
  },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

describe("GET /api/teacher/intervention-queue classId validation", () => {
  const validCuid = "clx1abcd23efgh45ijkl67mn";

  beforeEach(() => {
    mockAssertStaffCanManageClass.mock.resetCalls();
    mockGetInterventionQueue.mock.resetCalls();
    mockAssertStaffCanManageClass.mock.mockImplementation(async () => ({ id: validCuid }));
    mockGetInterventionQueue.mock.mockImplementation(async () => ({ queue: [] }));
  });

  it("returns cross-class results when no classId is provided", async () => {
    const req = mockRequest("/api/teacher/intervention-queue", { method: "GET" });
    const res = await route.GET(req as never);
    assert.equal(res.status, 200);
    assert.equal(mockAssertStaffCanManageClass.mock.callCount(), 0);
    const [, options] = mockGetInterventionQueue.mock.calls[0]?.arguments ?? [];
    assert.equal(options?.classId, undefined);
  });

  it("forwards a valid classId after authorizing the class", async () => {
    const req = mockRequest(`/api/teacher/intervention-queue?classId=${validCuid}`, {
      method: "GET",
    });
    const res = await route.GET(req as never);
    assert.equal(res.status, 200);
    assert.equal(mockAssertStaffCanManageClass.mock.callCount(), 1);
    const [, options] = mockGetInterventionQueue.mock.calls[0]?.arguments ?? [];
    assert.equal(options?.classId, validCuid);
  });

  it("rejects malformed classId with 400", async () => {
    const req = mockRequest("/api/teacher/intervention-queue?classId=bad!!id", {
      method: "GET",
    });
    const res = await route.GET(req as never);
    assert.equal(res.status, 400);
    assert.equal(mockAssertStaffCanManageClass.mock.callCount(), 0);
    assert.equal(mockGetInterventionQueue.mock.callCount(), 0);
  });

  it("propagates 403 when the teacher does not manage the class", async () => {
    mockAssertStaffCanManageClass.mock.mockImplementationOnce(async () => {
      throw makeHttpError(403, "You do not have access to this class.");
    });
    const req = mockRequest(`/api/teacher/intervention-queue?classId=${validCuid}`, {
      method: "GET",
    });
    const res = await route.GET(req as never);
    assert.equal(res.status, 403);
    assert.equal(mockGetInterventionQueue.mock.callCount(), 0);
  });
});
