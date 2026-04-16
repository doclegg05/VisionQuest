/* eslint-disable @typescript-eslint/no-explicit-any -- mock.fn() scaffolding is assigned to many different real function signatures; a shared "accept any implementation" escape hatch is intentional for test setup only. */
import assert from "node:assert/strict";
import test, { mock } from "node:test";

const mockFindMany = mock.fn() as any;

// mock.module goes through Node's native resolver, which does not honor
// the "@/*" path alias from tsconfig — use a relative path.
mock.module("./db", {
  namedExports: {
    prisma: {
      spokesClassInstructor: {
        findMany: mockFindMany,
      },
    },
  },
});

// Single top-level async test() is used instead of describe()+before():
// on Node 20 (the CI version), top-level before() does not reliably fire
// before describe() children under --experimental-test-module-mocks.
// Loading ./classroom *inside* the test body guarantees mock.module() above
// has already registered, and the dynamic import order is deterministic.
test("classroom limits", async (t) => {
  const { assertTeacherAssignmentLimit, normalizeInstructorIds } = await import("./classroom");

  await t.test("normalizeInstructorIds trims, removes empties, and de-duplicates", () => {
    assert.deepEqual(
      normalizeInstructorIds([" teacher-1 ", "teacher-2", "teacher-1", ""]),
      ["teacher-1", "teacher-2"],
    );
  });

  await t.test("assertTeacherAssignmentLimit: allows a teacher's second active class", async () => {
    mockFindMany.mock.resetCalls();
    mockFindMany.mock.mockImplementationOnce(async () => [{ instructorId: "teacher-1" }]);

    await assert.doesNotReject(async () => {
      await assertTeacherAssignmentLimit(["teacher-1"]);
    });
  });

  await t.test("assertTeacherAssignmentLimit: rejects a teacher's third active class", async () => {
    mockFindMany.mock.resetCalls();
    mockFindMany.mock.mockImplementationOnce(async () => [
      { instructorId: "teacher-1" },
      { instructorId: "teacher-1" },
    ]);

    await assert.rejects(
      assertTeacherAssignmentLimit(["teacher-1"]),
      /up to 2 active classes/i,
    );
  });

  await t.test("assertTeacherAssignmentLimit: ignores the current class when updating an existing assignment", async () => {
    mockFindMany.mock.resetCalls();
    mockFindMany.mock.mockImplementationOnce(async () => [{ instructorId: "teacher-1" }]);

    await assert.doesNotReject(async () => {
      await assertTeacherAssignmentLimit(["teacher-1"], {
        excludeClassId: "class-123",
        targetClassStatus: "active",
      });
    });
  });

  await t.test("assertTeacherAssignmentLimit: does not count archived classes toward the cap", async () => {
    mockFindMany.mock.resetCalls();
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
