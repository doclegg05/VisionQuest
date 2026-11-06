import { badRequest, forbidden, type Session } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { isDemoInstructor } from "@/lib/demo/guards";
import { PROGRAM_COORDINATOR } from "@/lib/org-roles";

export const NON_ARCHIVED_ENROLLMENT_STATUSES = [
  "active",
  "inactive",
  "completed",
  "withdrawn",
] as const;

export const MAX_ACTIVE_CLASSES_PER_TEACHER = 2;

/**
 * Roles that see every class and student in the state, whatever their
 * assignments. The organization tree (Phase 1, 2026-11) narrows everyone else:
 *
 *   admin, program_coordinator → every class and student, including intake
 *                                applicants who have no class yet
 *   coordinator (regional)     → classes in the regions they are assigned to
 *                                through RegionCoordinator; none if they have
 *                                no region; never a class with no region
 *   teacher (instructor)       → classes they are an assigned instructor of
 *   cdc, student, anything else → the instructor branch, which for them
 *                                matches nothing they do not instruct
 *
 * Both layers enforce the same tree. RLS (`managed_student_ids`,
 * `instructor_class_ids`, migration 20261107120000) is the backstop; this list
 * keeps app queries from asking for rows the database will refuse.
 *
 * Keep this list equal to `seesWholeState` in `src/lib/org-roles.ts`.
 */
export const STAFF_CAN_MANAGE_ANY: readonly string[] = ["admin", PROGRAM_COORDINATOR];

export function canManageAnyClass(role: string): boolean {
  return STAFF_CAN_MANAGE_ANY.includes(role);
}

/**
 * `canManageAnyClass` for a whole session. The shared demo instructor is a
 * `teacher` row and so already takes the instructor branch; the check stays so
 * that a demo account can never be widened by a role change. Every other
 * session answers exactly as `canManageAnyClass(session.role)` does.
 */
export function canManageAnyClassFor(session: Pick<Session, "role" | "demoAccount">): boolean {
  return canManageAnyClass(session.role) && !isDemoInstructor(session);
}

/**
 * Roles allowed to take an admin/coordinator-only action. This is a
 * PRIVILEGE TIER, not a scope breadth.
 *
 * Read it against `STAFF_CAN_MANAGE_ANY` above, which answers a different
 * question:
 *
 *   canManageAnyClass(role)            → "may this role see every class in
 *                                        the state?" (BREADTH: admin and
 *                                        program coordinator only)
 *   canPerformElevatedStaffAction(role) → "may this role take an action
 *                                        reserved to admins/coordinators?"
 *                                        (TIER: both coordinator roles yes,
 *                                        teacher no)
 *
 * They disagree about the regional `coordinator` on purpose: a regional
 * coordinator holds the elevated tier but sees only their regions. Two routes
 * once used a breadth predicate as a tier gate while their own error copy said
 * "admins and coordinators": the form-response CSV export and student class
 * reassignment. The tier never widens reach; the rows those actions touch are
 * still scoped by `buildManagedStudentWhere`.
 *
 * Do NOT merge these two lists, and do not add `teacher` here to make a call
 * site compile. `src/lib/classroom.test.ts` pins the pair apart.
 */
export const ELEVATED_STAFF: readonly string[] = ["admin", PROGRAM_COORDINATOR, "coordinator"];

export function canPerformElevatedStaffAction(role: string): boolean {
  return ELEVATED_STAFF.includes(role);
}

export function normalizeClassCode(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function normalizeInstructorIds(instructorIds: string[]): string[] {
  return [...new Set(instructorIds.map((id) => id.trim()).filter(Boolean))];
}

/**
 * The SpokesClass filter for the classes a session may manage, following the
 * organization tree (see `STAFF_CAN_MANAGE_ANY`). `{}` means every class.
 *
 * A regional coordinator reaches a class only through its region's
 * RegionCoordinator rows, read live on every request, so removing a
 * coordinator from a region takes effect on their next request. A class with
 * no region matches no regional coordinator: `region: { ... }` never matches a
 * null relation.
 */
export function buildManagedClassWhere(session: Session): Record<string, unknown> {
  if (canManageAnyClassFor(session)) return {};
  if (session.role === "coordinator") {
    return { region: { coordinators: { some: { coordinatorId: session.id } } } };
  }
  return { instructors: { some: { instructorId: session.id } } };
}

/**
 * The Student filter for the students a session may manage. Same tree as
 * `buildManagedClassWhere`, reached through the student's enrollments:
 *
 *   - admin and program coordinator with no classId get the UNSCOPED clause,
 *     so they also see intake applicants with no enrollment.
 *   - everyone else needs a non-archived enrollment (unless
 *     `includeArchivedEnrollments`) in a class they manage. A teacher who
 *     handled intake for a student outside their classes no longer sees them.
 *
 * Coordinators reached zero rows here before the tree (an impossible
 * `id: { in: [] }` clause), because RLS collapsed them to the student role.
 * RLS now maps them to the teacher role and scopes them to their regions, and
 * this clause asks the same question.
 */
export function buildManagedStudentWhere(
  session: Session,
  options: {
    classId?: string;
    includeArchivedEnrollments?: boolean;
    includeInactiveAccounts?: boolean;
  } = {},
) {
  const { classId, includeArchivedEnrollments = false, includeInactiveAccounts = true } = options;

  const baseWhere: Record<string, unknown> = {
    role: "student",
    ...(includeInactiveAccounts ? {} : { isActive: true }),
  };

  if (canManageAnyClassFor(session) && !classId) {
    return baseWhere;
  }

  const classWhere = buildManagedClassWhere(session);
  return {
    ...baseWhere,
    classEnrollments: {
      some: {
        ...(includeArchivedEnrollments ? {} : { status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] } }),
        ...(classId ? { classId } : {}),
        ...(Object.keys(classWhere).length > 0 ? { class: classWhere } : {}),
      },
    },
  };
}

export function buildStudentIdentifierWhere(identifier: string) {
  return {
    OR: [
      { id: identifier },
      { studentId: identifier },
    ],
  };
}

export async function assertStaffCanManageClass(session: Session, classId: string) {
  const managedClass = await prisma.spokesClass.findFirst({
    where: {
      id: classId,
      ...buildManagedClassWhere(session),
    },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
    },
  });

  if (!managedClass) {
    throw forbidden("You do not have access to this class.");
  }

  return managedClass;
}

export async function assertTeacherAssignmentLimit(
  instructorIds: string[],
  options: {
    excludeClassId?: string;
    targetClassStatus?: string | null;
  } = {},
) {
  const normalizedInstructorIds = normalizeInstructorIds(instructorIds);
  if (normalizedInstructorIds.length === 0) {
    return;
  }

  const targetClassStatus = options.targetClassStatus?.trim().toLowerCase() || "active";
  if (targetClassStatus === "archived") {
    return;
  }

  const activeAssignments = await prisma.spokesClassInstructor.findMany({
    where: {
      instructorId: { in: normalizedInstructorIds },
      ...(options.excludeClassId ? { classId: { not: options.excludeClassId } } : {}),
      class: {
        status: { not: "archived" },
      },
    },
    select: {
      instructorId: true,
    },
  });

  const assignmentCounts = new Map<string, number>();
  for (const assignment of activeAssignments) {
    assignmentCounts.set(
      assignment.instructorId,
      (assignmentCounts.get(assignment.instructorId) ?? 0) + 1,
    );
  }

  for (const instructorId of normalizedInstructorIds) {
    const projectedCount = (assignmentCounts.get(instructorId) ?? 0) + 1;
    if (projectedCount > MAX_ACTIVE_CLASSES_PER_TEACHER) {
      throw badRequest(
        `Teachers can only be assigned to up to ${MAX_ACTIVE_CLASSES_PER_TEACHER} active classes.`,
      );
    }
  }
}

export async function assertStaffCanManageStudent(session: Session, studentIdentifier: string) {
  const managedStudent = await prisma.student.findFirst({
    where: {
      AND: [
        buildStudentIdentifierWhere(studentIdentifier),
        buildManagedStudentWhere(session, { includeArchivedEnrollments: false }),
      ],
    },
    select: {
      id: true,
      displayName: true,
      studentId: true,
      role: true,
      isActive: true,
    },
  });

  if (!managedStudent) {
    throw forbidden("You do not have access to this student.");
  }

  return managedStudent;
}

export async function listManagedClasses(session: Session, options: { includeArchived?: boolean } = {}) {
  const { includeArchived = false } = options;

  return prisma.spokesClass.findMany({
    where: {
      ...(includeArchived ? {} : { status: { not: "archived" } }),
      ...buildManagedClassWhere(session),
    },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      programType: true,
      startDate: true,
      endDate: true,
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
}

export async function listManagedStudentIds(
  session: Session,
  options: {
    classId?: string;
    includeArchivedEnrollments?: boolean;
    includeInactiveAccounts?: boolean;
  } = {},
) {
  const students = await prisma.student.findMany({
    where: buildManagedStudentWhere(session, options),
    select: {
      id: true,
    },
  });

  return students.map((student) => student.id);
}
