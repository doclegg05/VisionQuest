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

test("buildManagedStudentWhere fails closed for coordinator with no class filter", () => {
  const where = buildManagedStudentWhere(
    {
      id: "coord-1",
      studentId: "coord-1",
      displayName: "Coordinator",
      role: "coordinator",
    },
    { includeInactiveAccounts: false },
  );

  // Coordinators never get an unscoped clause — they get an impossible one
  // (`id: { in: [] }` matches no row under any Prisma client). Coordinator
  // student reads go through region-scoped queries instead (mirror
  // getCoordinatorInterventionQueue in src/lib/teacher/dashboard.ts).
  assert.deepEqual(where, {
    role: "student",
    isActive: true,
    id: { in: [] },
  });
});

test("buildManagedStudentWhere fails closed for coordinator even with a class filter", () => {
  const where = buildManagedStudentWhere(
    {
      id: "coord-1",
      studentId: "coord-1",
      displayName: "Coordinator",
      role: "coordinator",
    },
    { classId: "class-1" },
  );

  assert.deepEqual(where, {
    role: "student",
    id: { in: [] },
  });
});

test("TRIPWIRE (Slice D): coordinator never receives an unscoped or reachable where-clause", () => {
  const coordinator = {
    id: "coord-1",
    studentId: "coord-1",
    displayName: "Coordinator",
    role: "coordinator",
  };

  const optionSets = [
    {},
    { classId: "class-1" },
    { includeArchivedEnrollments: true },
    { includeInactiveAccounts: false },
    {
      classId: "class-1",
      includeArchivedEnrollments: true,
      includeInactiveAccounts: false,
    },
  ];

  for (const options of optionSets) {
    const where = buildManagedStudentWhere(coordinator, options) as Record<string, unknown>;
    assert.deepEqual(
      where.id,
      { in: [] },
      `buildManagedStudentWhere produced a reachable coordinator clause for ` +
        `${JSON.stringify(options)} — coordinators must fail closed here. ` +
        `If Slice D is shipping first-class coordinator RLS policies, replace ` +
        `the fail-closed branch with real region scoping (mirror ` +
        `getCoordinatorInterventionQueue in src/lib/teacher/dashboard.ts) and ` +
        `audit every call site. See docs/plans/rls-enforcement-runbook.md → Slice D.`,
    );
  }
});

test("buildManagedStudentWhere keeps the unscoped clause for teachers with no class filter", () => {
  // Load-bearing semantics: the teacher dashboard, forms responses, export,
  // and grant/KPI reports all list across classes with no classId (single
  // SPOKES staff workspace). Do not narrow this without auditing those flows.
  const where = buildManagedStudentWhere({
    id: "teacher-1",
    studentId: "teacher-1",
    displayName: "Teacher",
    role: "teacher",
  });

  assert.deepEqual(where, { role: "student" });
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

test("TRIPWIRE (Slice D): coordinator sessions fail closed at BOTH the app layer and the RLS layer", () => {
  const coordinator = {
    id: "coord-1",
    studentId: "coord-1",
    displayName: "Coordinator",
    role: "coordinator",
  };

  // App layer: coordinators get an IMPOSSIBLE student where-clause
  // (`id: { in: [] }`), so queries built from this helper return zero rows
  // under ANY Prisma client, including prismaAdmin. Coordinator is still in
  // STAFF_CAN_MANAGE_ANY, but the coordinator guard runs first.
  assert.deepEqual(buildManagedStudentWhere(coordinator), {
    role: "student",
    id: { in: [] },
  });

  // RLS layer: rlsContextFor independently collapses coordinators to
  // role="student", so the vq_app client returns zero Student rows even for
  // code that bypasses buildManagedStudentWhere. Both layers now defend on
  // their own — this assertion breaking means Slice D is making rlsContextFor
  // coordinator-aware.
  assert.equal(
    rlsContextFor(coordinator).role,
    "student",
    "rlsContextFor no longer collapses coordinators — coordinator RLS policies " +
      "are going live (Slice D). buildManagedStudentWhere currently fails closed " +
      "for coordinators (impossible id-in-[] clause); replace that branch with " +
      "real region scoping (mirror getCoordinatorInterventionQueue in " +
      "src/lib/teacher/dashboard.ts) and audit its call sites before shipping. " +
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
