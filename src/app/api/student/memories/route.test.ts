/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { mockRequest, mockStudentSession, mockTeacherSession } from "@/lib/test-helpers";

const studentA = mockStudentSession({ id: "stu-A" });
const studentB = mockStudentSession({ id: "stu-B" });

const mockGetSession = mock.fn() as any;
const mockFindMany = mock.fn(async () => []) as any;
const mockCount = mock.fn(async () => 0) as any;

// api-error is left REAL so withAuth's 401/403 gate is what these tests
// exercise (same pattern as src/app/api/admin/placement-bridge/placement-bridge.test.ts);
// only its getSession dependency is stubbed. rls-context is pure
// AsyncLocalStorage and needs no mock.
mock.module("@/lib/auth", {
  namedExports: { getSession: mockGetSession },
});

mock.module("@/lib/db", {
  namedExports: { prisma: { sageMemory: { findMany: mockFindMany, count: mockCount } } },
});

let route: Awaited<typeof import("./route")>;

before(async () => {
  route = await import("./route");
});

function getRequest(searchParams?: Record<string, string>) {
  return mockRequest("/api/student/memories", { searchParams });
}

describe("GET /api/student/memories", () => {
  beforeEach(() => {
    mockGetSession.mock.resetCalls();
    mockFindMany.mock.resetCalls();
    mockCount.mock.resetCalls();
    mockGetSession.mock.mockImplementation(async () => studentA);
    mockFindMany.mock.mockImplementation(async () => []);
    mockCount.mock.mockImplementation(async () => 0);
  });

  it("rejects an unauthenticated request with 401", async () => {
    mockGetSession.mock.mockImplementation(async () => null);

    const res = await route.GET(getRequest());

    assert.equal(res.status, 401);
    assert.equal(mockFindMany.mock.calls.length, 0);
  });

  it("rejects a non-student (teacher) session with 403 — this is a self-only surface", async () => {
    mockGetSession.mock.mockImplementation(async () => mockTeacherSession());

    const res = await route.GET(getRequest());

    assert.equal(res.status, 403);
    assert.equal(mockFindMany.mock.calls.length, 0);
  });

  it("cross-student red-baseline: always queries the caller's own id, ignoring any studentId the client supplies", async () => {
    mockGetSession.mock.mockImplementation(async () => studentA);

    await route.GET(getRequest({ studentId: "stu-B" }));

    assert.equal(mockFindMany.mock.calls.length, 1);
    const where = mockFindMany.mock.calls[0].arguments[0].where;
    assert.equal(where.subjectId, "stu-A", "must use the session's own id, never a client-supplied one");
    assert.notEqual(where.subjectId, studentB.id);
  });

  it("field allowlist: the response never includes confidence, sourceId, kind, or embedding", async () => {
    mockFindMany.mock.mockImplementation(async () => [
      {
        id: "mem-1",
        content: "Wants to finish a CDL program",
        category: "goal",
        sourceType: "conversation",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    ]);
    mockCount.mock.mockImplementation(async () => 1);

    const res = await route.GET(getRequest());
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      success: boolean;
      data: { memories: Array<Record<string, unknown>> };
    };

    assert.equal(body.success, true);
    assert.equal(body.data.memories.length, 1);
    const keys = Object.keys(body.data.memories[0]).sort();
    assert.deepEqual(keys, ["category", "content", "createdAt", "id", "sourceType"]);
  });

  it("returns pagination metadata derived from page/limit query params", async () => {
    mockCount.mock.mockImplementation(async () => 45);

    const res = await route.GET(getRequest({ page: "2", limit: "10" }));
    assert.equal(res.status, 200);

    const args = mockFindMany.mock.calls[0].arguments[0];
    assert.equal(args.skip, 10);
    assert.equal(args.take, 10);

    const body = (await res.json()) as { data: { pagination: { page: number; limit: number; total: number } } };
    assert.deepEqual(body.data.pagination, { page: 2, limit: 10, total: 45 });
  });

  it("rejects an out-of-range limit with 400", async () => {
    const res = await route.GET(getRequest({ limit: "500" }));
    assert.equal(res.status, 400);
    assert.equal(mockFindMany.mock.calls.length, 0);
  });

  it("defaults to page 1, limit 20 with no query params", async () => {
    await route.GET(getRequest());

    const args = mockFindMany.mock.calls[0].arguments[0];
    assert.equal(args.skip, 0);
    assert.equal(args.take, 20);
  });
});
