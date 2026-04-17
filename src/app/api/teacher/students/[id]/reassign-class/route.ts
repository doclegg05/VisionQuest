import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  withAuth,
  forbidden,
  badRequest,
  notFound,
  conflict,
} from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { prisma } from "@/lib/db";
import { canManageAnyClass } from "@/lib/classroom";
import { getStudentProgramType, type ProgramType } from "@/lib/program-type";

// POST /api/teacher/students/:id/reassign-class
// Admin or coordinator only. Archives the student's current active enrollment
// and creates a new active enrollment for the target class. Goals, files, and
// conversations are untouched (they live on Student, not Class). Sage's next
// turn reads the new program type via getStudentProgramType — no explicit
// invalidation needed.

const reassignSchema = z.object({
  newClassId: z
    .string()
    .min(1, "newClassId is required.")
    .max(64, "newClassId is too long."),
  reason: z
    .string()
    .max(500, "reason must be 500 characters or fewer.")
    .optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export const POST = withAuth(
  async (session, req: NextRequest, ctx: unknown) => {
    if (!canManageAnyClass(session.role)) {
      throw forbidden("Only admins and coordinators can reassign students.");
    }

    const { id: studentId } = await (ctx as RouteContext).params;
    const body = await parseBody(req as Request, reassignSchema);

    const student = await prisma.student.findFirst({
      where: { id: studentId, role: "student" },
      select: { id: true, displayName: true },
    });
    if (!student) {
      throw notFound("Student not found.");
    }

    const targetClass = await prisma.spokesClass.findUnique({
      where: { id: body.newClassId },
      select: {
        id: true,
        status: true,
        programType: true,
        name: true,
      },
    });
    if (!targetClass) {
      throw notFound("Target class not found.");
    }
    if (targetClass.status === "archived") {
      throw badRequest("Cannot reassign to an archived class.");
    }

    const currentEnrollment = await prisma.studentClassEnrollment.findFirst({
      where: { studentId, status: "active" },
      select: { id: true, classId: true },
    });

    if (currentEnrollment?.classId === body.newClassId) {
      throw conflict("Student is already enrolled in this class.");
    }

    await prisma.$transaction(async (tx) => {
      if (currentEnrollment) {
        await tx.studentClassEnrollment.update({
          where: { id: currentEnrollment.id },
          data: {
            status: "archived",
            archivedAt: new Date(),
            archiveReason: `reassigned_to_${body.newClassId}`,
          },
        });
      }
      await tx.studentClassEnrollment.create({
        data: {
          studentId,
          classId: body.newClassId,
          status: "active",
        },
      });
    });

    await prisma.auditLog.create({
      data: {
        actorId: session.id,
        actorRole: session.role,
        action: "teacher.student.reassign_class",
        targetType: "student",
        targetId: studentId,
        summary: `Reassigned ${student.displayName} to ${targetClass.name}`,
        metadata: JSON.stringify({
          oldClassId: currentEnrollment?.classId ?? null,
          newClassId: body.newClassId,
          newProgramType: targetClass.programType,
          reason: body.reason ?? null,
        }),
      },
    });

    const newProgramType: ProgramType = await getStudentProgramType(studentId);

    return NextResponse.json({
      success: true,
      data: {
        oldClassId: currentEnrollment?.classId ?? null,
        newClassId: body.newClassId,
        newProgramType,
      },
    });
  },
);
