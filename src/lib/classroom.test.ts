import assert from "node:assert/strict";
import test from "node:test";
import {
  NON_ARCHIVED_ENROLLMENT_STATUSES,
  STAFF_CAN_MANAGE_ANY,
  buildManagedStudentWhere,
  canManageAnyClass,
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

test("buildManagedStudentWhere returns unrestricted access for coordinator with no class filter", () => {
  const where = buildManagedStudentWhere(
    {
      id: "coord-1",
      studentId: "coord-1",
      displayName: "Coordinator",
      role: "coordinator",
    },
    { includeInactiveAccounts: false },
  );

  assert.deepEqual(where, {
    role: "student",
    isActive: true,
  });
});

test("buildManagedStudentWhere does NOT grant CDC unrestricted access", () => {
  const where = buildManagedStudentWhere(
    {
      id: "cdc-1",
      studentId: "cdc-1",
      displayName: "CDC",
      role: "cdc",
    },
    { classId: "class-1" },
  );

  // CDC scoped exactly like a teacher: must be an assigned instructor on the class.
  // (CDC-specific permissions ship in a later phase.)
  assert.deepEqual(where, {
    role: "student",
    classEnrollments: {
      some: {
        status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
        classId: "class-1",
        class: {
          instructors: {
            some: { instructorId: "cdc-1" },
          },
        },
      },
    },
  });
});

test("STAFF_CAN_MANAGE_ANY contains exactly admin and coordinator", () => {
  assert.deepEqual([...STAFF_CAN_MANAGE_ANY], ["admin", "coordinator"]);
});

test("canManageAnyClass returns true for admin and coordinator only", () => {
  assert.equal(canManageAnyClass("admin"), true);
  assert.equal(canManageAnyClass("coordinator"), true);
  assert.equal(canManageAnyClass("teacher"), false);
  assert.equal(canManageAnyClass("cdc"), false);
  assert.equal(canManageAnyClass("student"), false);
  assert.equal(canManageAnyClass(""), false);
});

test("getRoleHomePath routes each role to the correct landing page", () => {
  assert.equal(getRoleHomePath("admin"), "/admin");
  assert.equal(getRoleHomePath("coordinator"), "/coordinator");
  assert.equal(getRoleHomePath("teacher"), "/teacher");
  assert.equal(getRoleHomePath("cdc"), "/cdc");
  assert.equal(getRoleHomePath("student"), "/dashboard");
  assert.equal(getRoleHomePath("unknown"), "/dashboard");
});
