import crypto from "crypto";
import { forbidden, type Session } from "@/lib/api-error";
import { normalizeEmail, normalizeStudentId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const NON_ARCHIVED_ENROLLMENT_STATUSES = [
  "active",
  "inactive",
  "completed",
  "withdrawn",
] as const;

export function normalizeClassCode(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function createClassInviteToken() {
  const token = crypto.randomBytes(24).toString("base64url");
  return {
    token,
    tokenHash: hashInviteToken(token),
  };
}

export function hashInviteToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function normalizeInviteInput(input: {
  email: string;
  displayName?: string;
  suggestedStudentId?: string;
}) {
  return {
    email: normalizeEmail(input.email),
    displayName: input.displayName?.trim() || "",
    suggestedStudentId: input.suggestedStudentId ? normalizeStudentId(input.suggestedStudentId) : "",
  };
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

  if (session.role === "admin" && !classId) {
    return baseWhere;
  }

  return {
    ...baseWhere,
    classEnrollments: {
      some: {
        ...(includeArchivedEnrollments ? {} : { status: { in: [...NON_ARCHIVED_ENROLLMENT_STATUSES] } }),
        ...(classId ? { classId } : {}),
        ...(session.role === "admin"
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
  const managedClass = await prisma.spokesClass.findFirst({
    where: {
      id: classId,
      ...(session.role === "admin"
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
      ...(session.role === "admin"
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

export async function findValidClassInviteByToken(token: string) {
  const tokenHash = hashInviteToken(token);
  const now = new Date();

  return prisma.classEnrollmentInvite.findFirst({
    where: {
      tokenHash,
      claimedAt: null,
      expiresAt: { gt: now },
      class: { status: "active" },
    },
    include: {
      class: {
        select: {
          id: true,
          name: true,
          code: true,
          status: true,
        },
      },
    },
  });
}
