import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// isDemoStudentId reads one column through the ADMIN client: callers reach it
// from a student's RLS context (the crisis path, the nudge path), where the app
// client could hide the very row being asked about. The app-client twin below
// throws, so a regression to it turns these cases red.

const mockFindUnique = mock.fn<(args: unknown) => Promise<unknown>>();
const mockAppFindUnique = mock.fn<(args: unknown) => Promise<unknown>>(async () => {
  throw new Error("the app client must not be used for the demo check");
});

mock.module("@/lib/db", {
  exports: {
    prisma: { student: { findUnique: mockAppFindUnique } },
    prismaAdmin: { student: { findUnique: mockFindUnique } },
  },
});

let isDemoStudentId: typeof import("./accounts").isDemoStudentId;

before(async () => {
  ({ isDemoStudentId } = await import("./accounts"));
});

describe("isDemoStudentId", () => {
  beforeEach(() => {
    mockFindUnique.mock.resetCalls();
    mockAppFindUnique.mock.resetCalls();
  });

  it("is true for a demo student", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({ demoAccount: "student" }));
    assert.equal(await isDemoStudentId("stu-1"), true);
  });

  it("is true for the demo instructor", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({ demoAccount: "instructor" }));
    assert.equal(await isDemoStudentId("inst-1"), true);
  });

  it("is false for a real person", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({ demoAccount: null }));
    assert.equal(await isDemoStudentId("stu-2"), false);
  });

  it("is false when there is no such row, so real-account behavior is unchanged", async () => {
    mockFindUnique.mock.mockImplementation(async () => null);
    assert.equal(await isDemoStudentId("missing"), false);
  });

  it("asks the admin client for the id and reads only the demo column", async () => {
    mockFindUnique.mock.mockImplementation(async () => ({ demoAccount: null }));
    await isDemoStudentId("stu-3");

    assert.equal(mockFindUnique.mock.callCount(), 1);
    assert.deepEqual(mockFindUnique.mock.calls[0].arguments[0], {
      where: { id: "stu-3" },
      select: { demoAccount: true },
    });
    assert.equal(mockAppFindUnique.mock.callCount(), 0, "the app client is never used");
  });

  it("lets a lookup failure reach the caller instead of guessing", async () => {
    mockFindUnique.mock.mockImplementation(async () => {
      throw new Error("db down");
    });
    await assert.rejects(isDemoStudentId("stu-4"), /db down/);
  });
});
