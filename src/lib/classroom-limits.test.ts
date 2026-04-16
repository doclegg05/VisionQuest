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

describe("normalizeInstructorIds", () => {
  it("trims, removes empties, and de-duplicates instructor ids", () => {
    assert.deepEqual(
      normalizeInstructorIds([" teacher-1 ", "teacher-2", "teacher-1", ""]),
      ["teacher-1", "teacher-2"],
    );
  });
});

describe("assertTeacherAssignmentLimit", () => {
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
