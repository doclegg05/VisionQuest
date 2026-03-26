import assert from "node:assert/strict";
import test from "node:test";
import {
  NON_ARCHIVED_ENROLLMENT_STATUSES,
  buildManagedStudentWhere,
  normalizeClassCode,
} from "./classroom";
import { getRoleHomePath } from "./role-home";

test("normalizeClassCode creates a stable class slug", () => {
  assert.equal(normalizeClassCode("  SPOKES Class 2026 / AM  "), "spokes-class-2026-am");
});


test("buildManagedStudentWhere returns unrestricted admin access when no class is selected", () => {
  const where = buildManagedStudentWhere(
    {
      id: "admin-1",
      studentId: "admin-1",
      displayName: "Admin",
      role: "admin",
    },
    { includeInactiveAccounts: false },
  );

  assert.deepEqual(where, {
    role: "student",
    isActive: true,
  });
});

test("buildManagedStudentWhere scopes teachers to their class roster", () => {
  const where = buildManagedStudentWhere(
    {
      id: "teacher-1",
      studentId: "teacher-1",
      displayName: "Teacher",
      role: "teacher",
    },
    { classId: "class-1" },
  );

  assert.deepEqual(where, {
    role: "student",
    classEnrollments: {
      some: {
        status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
        classId: "class-1",
        class: {
          instructors: {
            some: { instructorId: "teacher-1" },
          },
        },
      },
    },
  });
});

test("getRoleHomePath routes each role to the correct landing page", () => {
  assert.equal(getRoleHomePath("admin"), "/admin");
  assert.equal(getRoleHomePath("teacher"), "/teacher");
  assert.equal(getRoleHomePath("student"), "/dashboard");
});
