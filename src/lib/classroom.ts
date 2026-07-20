import { badRequest, forbidden, type Session } from "@/lib/api-error";
import { prisma } from "@/lib/db";

export const NON_ARCHIVED_ENROLLMENT_STATUSES = [
  "active",
  "inactive",
  "completed",
  "withdrawn",
] as const;

export const MAX_ACTIVE_CLASSES_PER_TEACHER = 2;

/**
 * Roles allowed to view/manage students and classes regardless of direct
 * instructor assignment. VisionQuest is a single SPOKES staff workspace:
 * instructors/admins need the same operational access to student profiles,
 * classes, and intervention surfaces.
 *
 * CDC is intentionally NOT included: their read-across-region scope is
 * narrower and ships with their dashboard in a later phase.
 */
export const STAFF_CAN_MANAGE_ANY: readonly string[] = ["admin", "teacher", "coordinator"];

export function canManageAnyClass(role: string): boolean {
  return STAFF_CAN_MANAGE_ANY.includes(role);
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
 * ⚠️ Slice D invariant: coordinator sessions ALWAYS fail closed here — they
 * receive an impossible where-clause (`id: { in: [] }`) from every branch,
 * so any query built from this helper returns zero Student rows regardless
 * of which Prisma client runs it (including prismaAdmin). This matches the
 * pre-existing effective behavior: rlsContextFor (src/lib/api-error.ts)
 * collapses coordinator sessions to role="student", so the RLS-scoped
 * client already returned zero rows under vq_app. Both layers now defend
 * independently.
 *
 * Coordinator student reads must instead use explicitly region-scoped
 * queries — mirror getCoordinatorInterventionQueue in
 * src/lib/teacher/dashboard.ts. When Slice D ships first-class coordinator
 * RLS policies, replace the fail-closed branch below with real region
 * scoping and update the tripwire tests in classroom.test.ts,
 * api-error.test.ts, and rls-headers.test.ts (they fail to flag this).
 *
 * Admin and teacher semantics are unchanged: with no classId they get the
 * UNSCOPED student where-clause by design (single SPOKES staff workspace —
 * the teacher dashboard, exports, and reports list across classes), and
 * non-staff roles are narrowed to classes where they are an assigned
 * instructor.
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

  // Coordinators fail closed on every branch — see the invariant note above.
  // `id: { in: [] }` can never match a row, so the clause is impossible by
  // construction under any Prisma client.
  if (session.role === "coordinator") {
    return {
      ...baseWhere,
      id: { in: [] as string[] },
    };
  }

  const canManageAny = canManageAnyClass(session.role);

  if (canManageAny && !classId) {
    return baseWhere;
  }

  return {
    ...baseWhere,
    classEnrollments: {
      some: {
        ...(includeArchivedEnrollments ? {} : { status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] } }),
        ...(classId ? { classId } : {}),
        ...(canManageAny
          ? {}
          : {
              class: {
                instructors: {
                  some: { instructorId: session.id },
                },
              },
            }),
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
  const canManageAny = canManageAnyClass(session.role);
  const managedClass = await prisma.spokesClass.findFirst({
    where: {
      id: classId,
      ...(canManageAny
        ? {}
        : {
            instructors: {
              some: {
                instructorId: session.id,
              },
            },
          }),
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
      ...(canManageAnyClass(session.role)
        ? {}
        : {
            instructors: {
              some: {
                instructorId: session.id,
              },
            },
          }),
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
