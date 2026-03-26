import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { hashPassword, normalizeStudentId, normalizeEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { parseBody, createStudentSchema } from "@/lib/schemas";

export const POST = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id: classId } = await params;
  const managedClass = await assertStaffCanManageClass(session, classId);

  if (managedClass.status !== "active") {
    throw badRequest("Cannot add students to an archived class.");
  }

  const body = await parseBody(req, createStudentSchema);
  const studentId = normalizeStudentId(body.studentId);
  const displayName = body.displayName.trim();
  const password = body.password.trim();
  const email = body.email ? normalizeEmail(body.email) : null;

  const existing = await prisma.student.findFirst({
    where: {
      OR: [
        { studentId },
        ...(email ? [{ email }] : []),
      ],
    },
    select: { studentId: true, email: true },
  });

  if (existing) {
    if (existing.studentId === studentId) {
      throw badRequest("That username is already taken.");
    }
    throw badRequest("That email is already registered.");
  }

  const { hash } = hashPassword(password);

  const student = await prisma.$transaction(async (tx) => {
    const created = await tx.student.create({
      data: {
        studentId,
        displayName,
        passwordHash: hash,
        email: email || null,
        role: "student",
      },
    });

    await tx.studentClassEnrollment.create({
      data: {
        classId,
        studentId: created.id,
        status: "active",
      },
    });

    return created;
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "class.student.create",
    targetType: "student",
    targetId: student.id,
    summary: `Created student ${student.studentId} and enrolled in ${managedClass.name}.`,
    metadata: { classId, studentId: student.id },
  });

  return NextResponse.json({
    student: {
      id: student.id,
      studentId: student.studentId,
      displayName: student.displayName,
      email: student.email,
    },
  });
});
