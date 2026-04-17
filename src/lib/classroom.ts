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
 * instructor assignment. Coordinator inherits admin's cross-class read scope
 * (Phase 1) — write scopes for coordinator are wired in Phase 5.
 *
 * CDC is intentionally NOT included: their read-across-region scope is
 * narrower and ships with their dashboard in a later phase.
 */
export const STAFF_CAN_MANAGE_ANY: readonly string[] = ["admin", "coordinator"];

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

export async function assertStaffCanManageStudent(session: Session, studentId: string) {
  const managedStudent = await prisma.student.findFirst({
    where: {
      id: studentId,
      ...buildManagedStudentWhere(session, { includeArchivedEnrollments: false }),
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
