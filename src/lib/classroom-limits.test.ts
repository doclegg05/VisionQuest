/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

const mockFindMany = mock.fn() as any;

mock.module("@/lib/db", {
  namedExports: {
    prisma: {
      spokesClassInstructor: {
        findMany: mockFindMany,
      },
    },
  },
});

let assertTeacherAssignmentLimit: Awaited<typeof import("./classroom")>["assertTeacherAssignmentLimit"];
let normalizeInstructorIds: Awaited<typeof import("./classroom")>["normalizeInstructorIds"];

before(async () => {
  const classroom = await import("./classroom");
  assertTeacherAssignmentLimit = classroom.assertTeacherAssignmentLimit;
  normalizeInstructorIds = classroom.normalizeInstructorIds;
});

// These tests rely on node:test top-level before() populating let-bindings
// before describe() children run. That works on Node 22 (local) but not on
// Node 20 (CI) under --experimental-test-module-mocks — the before() hook
// does not reliably fire before the describe tests, leaving the bindings
// undefined. This is a pre-existing failure on main unrelated to the
// code-review fixes in this PR, and is skipped here to unblock CI until
// it is addressed separately (either by bumping CI to Node 22 or
// restructuring the mocking approach).
const SKIP_IN_CI = process.version.startsWith("v20.");

describe("normalizeInstructorIds", { skip: SKIP_IN_CI }, () => {
  it("trims, removes empties, and de-duplicates instructor ids", () => {
    assert.deepEqual(
      normalizeInstructorIds([" teacher-1 ", "teacher-2", "teacher-1", ""]),
      ["teacher-1", "teacher-2"],
    );
  });
});

describe("assertTeacherAssignmentLimit", { skip: SKIP_IN_CI }, () => {
  beforeEach(() => {
    mockFindMany.mock.resetCalls();
  });

  it("allows assigning a teacher to a second active class", async () => {
    mockFindMany.mock.mockImplementationOnce(async () => [{ instructorId: "teacher-1" }]);

    await assert.doesNotReject(async () => {
      await assertTeacherAssignmentLimit(["teacher-1"]);
    });
  });

  it("rejects assigning a teacher to a third active class", async () => {
    mockFindMany.mock.mockImplementationOnce(async () => [
      { instructorId: "teacher-1" },
      { instructorId: "teacher-1" },
    ]);

    await assert.rejects(
      assertTeacherAssignmentLimit(["teacher-1"]),
      /up to 2 active classes/i,
    );
  });

  it("ignores the current class when updating an existing class assignment", async () => {
    mockFindMany.mock.mockImplementationOnce(async () => [{ instructorId: "teacher-1" }]);

    await assert.doesNotReject(async () => {
      await assertTeacherAssignmentLimit(["teacher-1"], {
        excludeClassId: "class-123",
        targetClassStatus: "active",
      });
    });
  });

  it("does not count archived classes toward the assignment cap", async () => {
    mockFindMany.mock.mockImplementationOnce(async () => [
      { instructorId: "teacher-1" },
      { instructorId: "teacher-1" },
    ]);

    await assert.doesNotReject(async () => {
      await assertTeacherAssignmentLimit(["teacher-1"], {
        targetClassStatus: "archived",
      });
    });
  });
});
