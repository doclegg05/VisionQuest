/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() is deliberately loose for test scaffolding. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// The two-active-classes limit is counted inside the admin transaction, so it
// sees co-teacher links that RLS hides from the caller. Only @/lib/db is
// mocked: the real @/lib/classroom runs the limit.

const mockLinkFindMany = mock.fn() as any;
const mockCodeLookup = mock.fn() as any;
const mockClassCreate = mock.fn() as any;
const mockLinkCreateMany = mock.fn() as any;
// The RLS client must not be asked to count: no spokesClassInstructor on it.
const rlsClient = {};

const tx = {
  spokesClass: { findUnique: mockCodeLookup, create: mockClassCreate },
  spokesClassInstructor: { findMany: mockLinkFindMany, createMany: mockLinkCreateMany },
};

mock.module("@/lib/db", {
  namedExports: {
    prisma: rlsClient,
    prismaAdmin: { $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) },
  },
});

let createClassWithInstructors: Awaited<typeof import("./class-create")>["createClassWithInstructors"];
before(async () => {
  ({ createClassWithInstructors } = await import("./class-create"));
});

const INPUT = {
  name: "Cohort",
  code: "cohort",
  programType: "spokes",
  regionId: "region-1",
  description: null,
  startDate: null,
  endDate: null,
  createdById: "teacher-1",
  instructorIds: ["teacher-1", "teacher-2"],
};

beforeEach(() => {
  for (const m of [mockLinkFindMany, mockCodeLookup, mockClassCreate, mockLinkCreateMany]) {
    m.mock.resetCalls();
  }
  mockCodeLookup.mock.mockImplementation(async () => null);
  mockClassCreate.mock.mockImplementation(async () => ({ id: "class-new", name: "Cohort", code: "cohort" }));
  mockLinkFindMany.mock.mockImplementation(async () => []);
});

describe("createClassWithInstructors teaching limit", () => {
  it("refuses a co-teacher who already teaches two active classes with others, and creates nothing", async () => {
    // Both links belong to classes taught together with other instructors; the
    // RLS client would have hidden them, the transaction client does not.
    mockLinkFindMany.mock.mockImplementation(async () => [
      { instructorId: "teacher-2" },
      { instructorId: "teacher-2" },
    ]);

    await assert.rejects(createClassWithInstructors(INPUT), /up to 2 active classes/i);
    assert.equal(mockClassCreate.mock.callCount(), 0);
    assert.equal(mockLinkCreateMany.mock.callCount(), 0);
  });

  it("counts through the transaction client", async () => {
    await createClassWithInstructors(INPUT);
    assert.equal(mockLinkFindMany.mock.callCount(), 1);
    const where = mockLinkFindMany.mock.calls[0].arguments[0].where;
    assert.deepEqual(where.instructorId, { in: ["teacher-1", "teacher-2"] });
  });

  it("creates the class when everyone has room", async () => {
    mockLinkFindMany.mock.mockImplementation(async () => [{ instructorId: "teacher-2" }]);
    const created = await createClassWithInstructors(INPUT);
    assert.equal(created.id, "class-new");
    assert.equal(mockLinkCreateMany.mock.callCount(), 1);
  });
});
