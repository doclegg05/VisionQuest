/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockFindMany = mock.fn(async () => []) as any;
const mockCount = mock.fn(async () => 0) as any;

mock.module("@/lib/db", {
  namedExports: { prisma: { sageMemory: { findMany: mockFindMany, count: mockCount } } },
});

let listOwnSageMemories: typeof import("./student-memories").listOwnSageMemories;

before(async () => {
  ({ listOwnSageMemories } = await import("./student-memories"));
});

describe("listOwnSageMemories", () => {
  beforeEach(() => {
    mockFindMany.mock.resetCalls();
    mockCount.mock.resetCalls();
    mockFindMany.mock.mockImplementation(async () => []);
    mockCount.mock.mockImplementation(async () => 0);
  });

  it("scopes the query to the caller's own student subject, excluding archived rows", async () => {
    await listOwnSageMemories("stu-A", { page: 1, limit: 20 });

    const where = mockFindMany.mock.calls[0].arguments[0].where;
    assert.deepEqual(where, {
      subjectType: "student",
      subjectId: "stu-A",
      validTo: null,
    });
    const countWhere = mockCount.mock.calls[0].arguments[0].where;
    assert.deepEqual(countWhere, where);
  });

  it("selects only the safe, student-facing fields — never confidence, sourceId, or embedding", async () => {
    await listOwnSageMemories("stu-A", { page: 1, limit: 20 });

    const select = mockFindMany.mock.calls[0].arguments[0].select;
    assert.deepEqual(select, {
      id: true,
      content: true,
      category: true,
      sourceType: true,
      createdAt: true,
    });
  });

  it("orders newest-first", async () => {
    await listOwnSageMemories("stu-A", { page: 1, limit: 20 });

    const orderBy = mockFindMany.mock.calls[0].arguments[0].orderBy;
    assert.deepEqual(orderBy, { createdAt: "desc" });
  });

  it("paginates with skip/take derived from page and limit", async () => {
    await listOwnSageMemories("stu-A", { page: 3, limit: 10 });

    const args = mockFindMany.mock.calls[0].arguments[0];
    assert.equal(args.skip, 20);
    assert.equal(args.take, 10);
  });

  it("returns the memories and total count together", async () => {
    mockFindMany.mock.mockImplementation(async () => [
      { id: "mem-1", content: "Wants a CDL", category: "goal", sourceType: "conversation", createdAt: new Date("2026-08-01") },
    ]);
    mockCount.mock.mockImplementation(async () => 7);

    const result = await listOwnSageMemories("stu-A", { page: 1, limit: 20 });

    assert.equal(result.total, 7);
    assert.equal(result.memories.length, 1);
    assert.equal(result.memories[0].id, "mem-1");
  });
});
