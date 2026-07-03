import assert from "node:assert/strict";
import test from "node:test";
import {
  NON_ARCHIVED_ENROLLMENT_STATUSES,
  STAFF_CAN_MANAGE_ANY,
  buildManagedStudentWhere,
  buildStudentIdentifierWhere,
  canManageAnyClass,
  normalizeClassCode,
} from "./classroom";
import { getRoleHomePath } from "./role-home";
import { rlsContextFor } from "./api-error";

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

test("buildManagedStudentWhere lets teachers filter by class without assignment narrowing", () => {
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
      },
    },
  });
});

test("buildStudentIdentifierWhere accepts internal id or visible username", () => {
  assert.deepEqual(buildStudentIdentifierWhere("britt"), {
    OR: [
      { id: "britt" },
      { studentId: "britt" },
    ],
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

test("TRIPWIRE (Slice D): unscoped coordinator where-clause is safe only while RLS collapses coordinators", () => {
  const coordinator = {
    id: "coord-1",
    studentId: "coord-1",
    displayName: "Coordinator",
    role: "coordinator",
  };

  // App layer: coordinators get an UNSCOPED student query (no class/region
  // narrowing) because coordinator is in STAFF_CAN_MANAGE_ANY…
  assert.deepEqual(buildManagedStudentWhere(coordinator), { role: "student" });

  // …which fails closed today ONLY because rlsContextFor collapses
  // coordinators to role="student", so no Student-table policy branch
  // matches. These two facts must change together.
  assert.equal(
    rlsContextFor(coordinator).role,
    "student",
    "rlsContextFor no longer collapses coordinators, but buildManagedStudentWhere " +
      "still returns an UNSCOPED student where-clause for them. Region-scope this " +
      "helper (mirror getCoordinatorInterventionQueue in src/lib/teacher/dashboard.ts) " +
      "and audit its call sites before shipping coordinator RLS policies (Slice D). " +
      "See docs/plans/rls-enforcement-runbook.md → Slice D.",
  );
});

test("STAFF_CAN_MANAGE_ANY contains staff roles with cross-class access", () => {
  assert.deepEqual([...STAFF_CAN_MANAGE_ANY], ["admin", "teacher", "coordinator"]);
});

test("canManageAnyClass returns true for instructor/admin staff roles", () => {
  assert.equal(canManageAnyClass("admin"), true);
  assert.equal(canManageAnyClass("teacher"), true);
  assert.equal(canManageAnyClass("coordinator"), true);
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
