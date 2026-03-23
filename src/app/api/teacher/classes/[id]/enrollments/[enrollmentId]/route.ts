import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

const VALID_ENROLLMENT_STATUSES = ["active", "inactive", "completed", "withdrawn", "archived"] as const;

export const PATCH = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string; enrollmentId: string }> },
) => {
  const { id: classId, enrollmentId } = await params;
  const managedClass = await assertStaffCanManageClass(session, classId);
  const body = await req.json();
  const status = typeof body.status === "string" ? body.status.trim() : "";
  const archiveReason = typeof body.archiveReason === "string" ? body.archiveReason.trim() : "";

  if (!VALID_ENROLLMENT_STATUSES.includes(status as (typeof VALID_ENROLLMENT_STATUSES)[number])) {
    throw badRequest("Enrollment status is invalid.");
  }

  const enrollment = await prisma.studentClassEnrollment.findFirst({
    where: {
      id: enrollmentId,
      classId,
    },
    select: {
      id: true,
      status: true,
      student: {
        select: {
          id: true,
          studentId: true,
          displayName: true,
        },
      },
    },
  });
  if (!enrollment) {
    return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
  }

  const updated = await prisma.studentClassEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status,
      archivedAt: status === "archived" ? new Date() : null,
      archiveReason: status === "archived" ? archiveReason || null : null,
    },
    select: {
      id: true,
      status: true,
      archivedAt: true,
      archiveReason: true,
    },
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "class.enrollment.update",
    targetType: "class_enrollment",
    targetId: enrollmentId,
    summary: `Marked ${enrollment.student.displayName} as ${status} in ${managedClass.name}.`,
    metadata: {
      classId,
      studentId: enrollment.student.id,
      enrollmentStatus: status,
    },
  });

  return NextResponse.json({ enrollment: updated });
});
