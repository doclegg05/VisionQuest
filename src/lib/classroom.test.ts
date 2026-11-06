import assert from "node:assert/strict";
import test, { describe, it } from "node:test";
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
import { rlsContextFor, type Session } from "./api-error";
import { matchesWhere, mockAdminSession, mockTeacherSession } from "./test-helpers";

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

test("buildManagedStudentWhere keeps a teacher's class filter inside the classes they teach", () => {
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

test("buildStudentIdentifierWhere accepts internal id or visible username", () => {
  assert.deepEqual(buildStudentIdentifierWhere("britt"), {
    OR: [
      { id: "britt" },
      { studentId: "britt" },
    ],
  });
});

test("buildManagedStudentWhere scopes a coordinator with no class filter to their regions", () => {
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
    classEnrollments: {
      some: {
        status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
        class: {
          region: { coordinators: { some: { coordinatorId: "coord-1" } } },
        },
      },
    },
  });
});

test("buildManagedStudentWhere keeps a coordinator's class filter inside their regions", () => {
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
    classEnrollments: {
      some: {
        status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
        classId: "class-1",
        class: {
          region: { coordinators: { some: { coordinatorId: "coord-1" } } },
        },
      },
    },
  });
});

test("TRIPWIRE: a coordinator never receives an unscoped or unregioned where-clause", () => {
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
    const where = buildManagedStudentWhere(coordinator, options) as {
      classEnrollments?: { some?: { class?: unknown } };
    };
    assert.deepEqual(
      where.classEnrollments?.some?.class,
      { region: { coordinators: { some: { coordinatorId: "coord-1" } } } },
      `buildManagedStudentWhere gave a coordinator a clause without their region ` +
        `scope for ${JSON.stringify(options)}. Regional coordinators reach students ` +
        `only through RegionCoordinator rows.`,
    );
  }
});

test("buildManagedStudentWhere scopes a teacher with no class filter to the classes they teach", () => {
  // The organization tree (2026-11) ended the single staff workspace: the
  // teacher dashboard, forms responses, export and reports now list only an
  // instructor's own classes. Admins and program coordinators stay unscoped.
  const where = buildManagedStudentWhere({
    id: "teacher-1",
    studentId: "teacher-1",
    displayName: "Teacher",
    role: "teacher",
  });

  assert.deepEqual(where, {
    role: "student",
    classEnrollments: {
      some: {
        status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
        class: {
          instructors: {
            some: { instructorId: "teacher-1" },
          },
        },
      },
    },
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

test("TRIPWIRE: coordinator sessions are region-scoped at the app layer and in RLS", () => {
  const coordinator = {
    id: "coord-1",
    studentId: "coord-1",
    displayName: "Coordinator",
    role: "coordinator",
  };

  // App layer: the region clause, never the unscoped one.
  assert.deepEqual(buildManagedStudentWhere(coordinator), {
    role: "student",
    classEnrollments: {
      some: {
        status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
        class: {
          region: { coordinators: { some: { coordinatorId: "coord-1" } } },
        },
      },
    },
  });

  // RLS layer (organization tree, migration 20261107120000): rlsContextFor
  // maps coordinators to the teacher RLS role, and managed_student_ids scopes
  // them to students in their regions' classes. Both layers ask one question.
  assert.equal(rlsContextFor(coordinator).role, "teacher");
});

test("STAFF_CAN_MANAGE_ANY contains only the roles that see the whole state", () => {
  assert.deepEqual([...STAFF_CAN_MANAGE_ANY], ["admin", "program_coordinator"]);
});

test("canManageAnyClass returns true for admins and program coordinators only", () => {
  assert.equal(canManageAnyClass("admin"), true);
  assert.equal(canManageAnyClass("program_coordinator"), true);
  assert.equal(canManageAnyClass("teacher"), false);
  assert.equal(canManageAnyClass("coordinator"), false);
  assert.equal(canManageAnyClass("cdc"), false);
  assert.equal(canManageAnyClass("student"), false);
  assert.equal(canManageAnyClass(""), false);
});

// --- Scope BREADTH vs privilege TIER -------------------------------------
// canManageAnyClass answers "may this role see every class in the state?"
// (breadth). canPerformElevatedStaffAction answers "may this role take an
// admin/coordinator-only action?" (tier). They are different questions and
// they disagree about the regional coordinator. Two routes once used the
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
  assert.deepEqual([...ELEVATED_STAFF], ["admin", "program_coordinator", "coordinator"]);
  assert.ok(
    !ELEVATED_STAFF.includes("teacher"),
    "ELEVATED_STAFF must never list teacher — it is the admin/coordinator privilege tier",
  );
  // They disagree about the regional coordinator by design: elevated tier,
  // regional breadth. If this ever stops being true the two predicates have
  // been merged and a regional coordinator reaches every region.
  assert.equal(canPerformElevatedStaffAction("coordinator"), true);
  assert.equal(canManageAnyClass("coordinator"), false);
  assert.equal(canManageAnyClass("teacher"), false);
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
// The demo instructor is a real `teacher` row. Since the organization tree every
// teacher takes the "assigned instructor" branch, and `canManageAnyClassFor`
// still says no to the demo account so a role change can never widen it.

const demoInstructor = {
  id: "demo-instructor-1",
  studentId: "demo-instructor",
  displayName: "Demo Instructor",
  role: "teacher",
  demoAccount: "instructor" as const,
};

test("canManageAnyClassFor answers true only for admins and program coordinators", () => {
  const base = { id: "u-1", studentId: "u-1", displayName: "User" };
  assert.equal(canManageAnyClassFor({ ...base, role: "admin" }), true);
  assert.equal(canManageAnyClassFor({ ...base, role: "program_coordinator" }), true);
  assert.equal(canManageAnyClassFor({ ...base, role: "teacher" }), false);
  assert.equal(canManageAnyClassFor({ ...base, role: "coordinator" }), false);
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

test("scopes a real teacher like the demo instructor, and keeps admins unscoped", () => {
  const realTeacher = {
    id: "teacher-1",
    studentId: "teacher-1",
    displayName: "Teacher",
    role: "teacher",
  };
  const teacherWhere = {
    role: "student",
    classEnrollments: {
      some: {
        status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] },
        class: { instructors: { some: { instructorId: "teacher-1" } } },
      },
    },
  };

  assert.deepEqual(buildManagedStudentWhere(realTeacher), teacherWhere);
  assert.deepEqual(buildManagedStudentWhere({ ...realTeacher, demoAccount: undefined }), teacherWhere);
  assert.deepEqual(
    buildManagedStudentWhere(
      { id: "admin-1", studentId: "admin-1", displayName: "Admin", role: "admin" },
      { includeInactiveAccounts: false },
    ),
    { role: "student", isActive: true },
  );
});

// --- Organization tree: who matches which student --------------------------
// Fixture rows shaped like org-tree-rls.test.ts: region A (coordinator CA,
// instructor TA, class A), region B (coordinator CB, instructor TB, class B),
// a class with no region (instructor T0), and an intake applicant with no
// class at all. `matchesWhere` walks the nested relation filters the way
// Postgres would, so these assert reach, not clause shape.

type FixtureClass = {
  id: string;
  instructors: Array<{ instructorId: string }>;
  region: { coordinators: Array<{ coordinatorId: string }> } | null;
};

const classA: FixtureClass = {
  id: "class-a",
  instructors: [{ instructorId: "TA" }],
  region: { coordinators: [{ coordinatorId: "CA" }] },
};
const classB: FixtureClass = {
  id: "class-b",
  instructors: [{ instructorId: "TB" }],
  region: { coordinators: [{ coordinatorId: "CB" }] },
};
const classNoRegion: FixtureClass = {
  id: "class-0",
  instructors: [{ instructorId: "T0" }],
  region: null,
};

function enrolledIn(id: string, cls: FixtureClass, status = "active") {
  return {
    id,
    role: "student",
    isActive: true,
    classEnrollments: [{ status, classId: cls.id, class: cls }],
  };
}

const studentSA = enrolledIn("SA", classA);
const studentSB = enrolledIn("SB", classB);
const studentS0 = enrolledIn("S0", classNoRegion);
const applicant = { id: "SI", role: "student", isActive: true, classEnrollments: [] };
const everyStudent = [studentSA, studentSB, studentS0, applicant];

function reachable(session: Session, options?: Parameters<typeof buildManagedStudentWhere>[1]) {
  const where = buildManagedStudentWhere(session, options);
  return everyStudent.filter((row) => matchesWhere(row, where)).map((row) => row.id);
}

describe("buildManagedStudentWhere follows the organization tree", () => {
  it("a teacher no longer matches a student outside their classes", () => {
    const where = buildManagedStudentWhere(mockTeacherSession({ id: "TA" }));
    assert.equal(matchesWhere(studentSB, where), false);
    assert.equal(matchesWhere(studentSA, where), true);
    assert.deepEqual(reachable(mockTeacherSession({ id: "TA" })), ["SA"]);
  });

  it("a teacher's class filter outside their classes matches nobody", () => {
    assert.deepEqual(reachable(mockTeacherSession({ id: "TA" }), { classId: "class-b" }), []);
  });

  it("a regional coordinator matches region A students only", () => {
    assert.deepEqual(reachable(mockTeacherSession({ id: "CA", role: "coordinator" })), ["SA"]);
  });

  it("a regional coordinator's class filter stays inside their region", () => {
    const coordinator = mockTeacherSession({ id: "CA", role: "coordinator" });
    assert.deepEqual(reachable(coordinator, { classId: "class-a" }), ["SA"]);
    assert.deepEqual(reachable(coordinator, { classId: "class-b" }), []);
  });

  it("a coordinator with no regions matches nobody", () => {
    const coordinator = mockTeacherSession({ id: "C-none", role: "coordinator" });
    assert.deepEqual(reachable(coordinator), []);
    assert.deepEqual(reachable(coordinator, { includeArchivedEnrollments: true }), []);
  });

  it("a class with no region is reached by its instructor, not by any regional coordinator", () => {
    assert.deepEqual(reachable(mockTeacherSession({ id: "T0" })), ["S0"]);
    assert.deepEqual(reachable(mockTeacherSession({ id: "CA", role: "coordinator" })), ["SA"]);
    assert.deepEqual(reachable(mockTeacherSession({ id: "CB", role: "coordinator" })), ["SB"]);
  });

  it("a program coordinator matches every student, including one with no class", () => {
    const programCoordinator = mockTeacherSession({ id: "PC", role: "program_coordinator" });
    assert.deepEqual(reachable(programCoordinator), ["SA", "SB", "S0", "SI"]);
  });

  it("an unenrolled intake applicant matches admins and program coordinators only", () => {
    const sessions = [
      mockAdminSession(),
      mockTeacherSession({ id: "PC", role: "program_coordinator" }),
      mockTeacherSession({ id: "TA" }),
      mockTeacherSession({ id: "CA", role: "coordinator" }),
      mockTeacherSession({ id: "CDC", role: "cdc" }),
    ];
    const seesApplicant = sessions.map((session) =>
      matchesWhere(applicant, buildManagedStudentWhere(session)),
    );
    assert.deepEqual(seesApplicant, [true, true, false, false, false]);
  });

  it("a coordinator does not reach a region A student through a withdrawn enrollment", () => {
    const withdrawn = enrolledIn("SW", classA, "archived");
    const where = buildManagedStudentWhere(mockTeacherSession({ id: "CA", role: "coordinator" }));
    assert.equal(matchesWhere(withdrawn, where), false);
  });
});

describe("tree role lists", () => {
  it("STAFF_CAN_MANAGE_ANY and ELEVATED_STAFF still differ", () => {
    assert.notDeepEqual([...STAFF_CAN_MANAGE_ANY], [...ELEVATED_STAFF]);
  });

  it("only admins and program coordinators manage every class", () => {
    assert.deepEqual([...STAFF_CAN_MANAGE_ANY], ["admin", "program_coordinator"]);
    assert.equal(canManageAnyClass("teacher"), false);
    assert.equal(canManageAnyClass("coordinator"), false);
  });

  it("the elevated tier is admins and both coordinator roles", () => {
    assert.deepEqual([...ELEVATED_STAFF], ["admin", "program_coordinator", "coordinator"]);
    assert.equal(canPerformElevatedStaffAction("program_coordinator"), true);
    assert.equal(canPerformElevatedStaffAction("teacher"), false);
  });
});
