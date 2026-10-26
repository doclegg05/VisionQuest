import assert from "node:assert/strict";
import test from "node:test";
import {
  ELEVATED_STAFF,
  NON_ARCHIVED_ENROLLMENT_STATUSES,
  STAFF_CAN_MANAGE_ANY,
  buildManagedStudentWhere,
  buildStudentIdentifierWhere,
  canManageAnyClass,
  canManageAnyClassFor,
  canPerformElevatedStaffAction,
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

// --- Scope BREADTH vs privilege TIER -------------------------------------
// canManageAnyClass answers "may this role see students outside the classes
// they teach?" (breadth). canPerformElevatedStaffAction answers "may this
// role take an admin/coordinator-only action?" (tier). They are different
// questions and they disagree about `teacher`. Two routes once used the
// breadth predicate as a tier gate — a plain teacher could stream a CSV of
// every form response and could reassign a student between classes. These
// assertions pin the two apart so they can never be silently re-merged.

test("canPerformElevatedStaffAction refuses plain teachers and non-staff", () => {
  assert.equal(canPerformElevatedStaffAction("teacher"), false);
  assert.equal(canPerformElevatedStaffAction("cdc"), false);
  assert.equal(canPerformElevatedStaffAction("student"), false);
  assert.equal(canPerformElevatedStaffAction(""), false);
});

test("canPerformElevatedStaffAction admits admins and coordinators", () => {
  assert.equal(canPerformElevatedStaffAction("admin"), true);
  assert.equal(canPerformElevatedStaffAction("coordinator"), true);
});

test("ELEVATED_STAFF and STAFF_CAN_MANAGE_ANY are NOT interchangeable", () => {
  assert.deepEqual([...ELEVATED_STAFF], ["admin", "coordinator"]);
  assert.ok(
    !ELEVATED_STAFF.includes("teacher"),
    "ELEVATED_STAFF must never list teacher — it is the admin/coordinator privilege tier",
  );
  // The breadth predicate still admits teachers, by design. If this ever
  // stops being true the two predicates have been merged and every
  // cross-class teacher surface (dashboard, exports, reports) changed.
  assert.equal(canManageAnyClass("teacher"), true);
  assert.equal(canPerformElevatedStaffAction("teacher"), false);
});

test("getRoleHomePath routes each role to the correct landing page", () => {
  assert.equal(getRoleHomePath("admin"), "/admin");
  assert.equal(getRoleHomePath("coordinator"), "/coordinator");
  assert.equal(getRoleHomePath("teacher"), "/teacher");
  assert.equal(getRoleHomePath("cdc"), "/cdc");
  assert.equal(getRoleHomePath("student"), "/dashboard");
  assert.equal(getRoleHomePath("unknown"), "/dashboard");
});

// --- Cohort demo mode: the demo instructor is narrowed to its own class ----
// The demo instructor is a real `teacher` row, so `canManageAnyClass("teacher")`
// is true for it. `canManageAnyClassFor` takes the whole session and says no to
// the demo instructor, which sends every helper in classroom.ts down the
// "assigned instructor" branch that non-staff roles already use.

const demoInstructor = {
  id: "demo-instructor-1",
  studentId: "demo-instructor",
  displayName: "Demo Instructor",
  role: "teacher",
  demoAccount: "instructor" as const,
};

test("canManageAnyClassFor keeps every staff role unscoped except the demo instructor", () => {
  const base = { id: "u-1", studentId: "u-1", displayName: "User" };
  assert.equal(canManageAnyClassFor({ ...base, role: "admin" }), true);
  assert.equal(canManageAnyClassFor({ ...base, role: "teacher" }), true);
  assert.equal(canManageAnyClassFor({ ...base, role: "coordinator" }), true);
  assert.equal(canManageAnyClassFor({ ...base, role: "cdc" }), false);
  assert.equal(canManageAnyClassFor({ ...base, role: "student" }), false);
  assert.equal(canManageAnyClassFor(demoInstructor), false);
});

test("scopes a demo instructor's student where to classes it teaches", () => {
  const where = buildManagedStudentWhere(demoInstructor) as {
    classEnrollments: { some: { class: { instructors: { some: { instructorId: string } } } } };
  };

  assert.equal(
    where.classEnrollments.some.class.instructors.some.instructorId,
    demoInstructor.id,
  );
  assert.deepEqual(buildManagedStudentWhere(demoInstructor), {
    role: "student",
    classEnrollments: {
      some: {
        status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
        class: {
          instructors: {
            some: { instructorId: demoInstructor.id },
          },
        },
      },
    },
  });
});

test("keeps a demo instructor's class filter inside the classes it teaches", () => {
  assert.deepEqual(buildManagedStudentWhere(demoInstructor, { classId: "class-1" }), {
    role: "student",
    classEnrollments: {
      some: {
        status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
        classId: "class-1",
        class: {
          instructors: {
            some: { instructorId: demoInstructor.id },
          },
        },
      },
    },
  });
});

test("keeps a real teacher unscoped", () => {
  const realTeacher = {
    id: "teacher-1",
    studentId: "teacher-1",
    displayName: "Teacher",
    role: "teacher",
  };

  assert.deepEqual(buildManagedStudentWhere(realTeacher), { role: "student" });
  assert.deepEqual(
    buildManagedStudentWhere({ ...realTeacher, demoAccount: undefined }),
    { role: "student" },
  );
  assert.deepEqual(
    buildManagedStudentWhere(
      { id: "admin-1", studentId: "admin-1", displayName: "Admin", role: "admin" },
      { includeInactiveAccounts: false },
    ),
    { role: "student", isActive: true },
  );
});
