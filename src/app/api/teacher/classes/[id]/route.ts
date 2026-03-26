import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, conflict } from "@/lib/api-error";
import { assertStaffCanManageClass, normalizeClassCode } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

function parseOptionalDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const GET = withTeacherAuth(async (
  session,
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  await assertStaffCanManageClass(session, id);

  const classRecord = await prisma.spokesClass.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      description: true,
      startDate: true,
      endDate: true,
      instructors: {
        select: {
          instructor: {
            select: {
              id: true,
              studentId: true,
              displayName: true,
              email: true,
            },
          },
        },
        orderBy: {
          instructor: { displayName: "asc" },
        },
      },
      enrollments: {
        select: {
          id: true,
          status: true,
          enrolledAt: true,
          archivedAt: true,
          archiveReason: true,
          student: {
            select: {
              id: true,
              studentId: true,
              displayName: true,
              email: true,
              isActive: true,
            },
          },
        },
        orderBy: [{ status: "asc" }, { student: { displayName: "asc" } }],
      },
    },
  });

  if (!classRecord) {
    return NextResponse.json({ error: "Class not found." }, { status: 404 });
  }

  return NextResponse.json({
    class: {
      ...classRecord,
      instructors: classRecord.instructors.map((entry) => entry.instructor),
    },
  });
});

export const PATCH = withTeacherAuth(async (
  session,
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
    const { id } = await params;
    const body = await req.json();

    const existing = await prisma.spokesClass.findUnique({
      where: { id },
      select: { id: true, name: true, code: true, status: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    const nextName = typeof body.name === "string" ? body.name.trim() : existing.name;
    const nextCode = normalizeClassCode(
      typeof body.code === "string" && body.code.trim() ? body.code : existing.code,
    );
    const nextStatus = typeof body.status === "string" ? body.status.trim() : existing.status;
    const description =
      body.description === ""
        ? null
        : typeof body.description === "string"
          ? body.description.trim()
          : undefined;
    const instructorIds = Array.isArray(body.instructorIds)
      ? body.instructorIds.filter(
          (value: unknown): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : null;

    if (!nextName) {
      throw badRequest("Class name is required.");
    }
    if (!nextCode) {
      throw badRequest("Class code is required.");
    }
    if (!["active", "archived"].includes(nextStatus)) {
      throw badRequest("Class status is invalid.");
    }

    const duplicate = await prisma.spokesClass.findFirst({
      where: {
        code: nextCode,
        NOT: { id },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw conflict("That class code is already in use.");
    }

    if (instructorIds) {
      const matchingTeachers = await prisma.student.count({
        where: {
          id: { in: instructorIds },
          role: "teacher",
        },
      });
      if (matchingTeachers !== instructorIds.length) {
        throw badRequest("One or more selected instructors are invalid.");
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.spokesClass.update({
        where: { id },
        data: {
          name: nextName,
          code: nextCode,
          status: nextStatus,
          description,
          archivedAt: nextStatus === "archived" ? new Date() : null,
          startDate: body.startDate !== undefined ? parseOptionalDate(body.startDate) : undefined,
          endDate: body.endDate !== undefined ? parseOptionalDate(body.endDate) : undefined,
        },
      });

      if (instructorIds) {
        await tx.spokesClassInstructor.deleteMany({ where: { classId: id } });
        if (instructorIds.length > 0) {
          await tx.spokesClassInstructor.createMany({
            data: instructorIds.map((instructorId: string) => ({
              classId: id,
              instructorId,
            })),
            skipDuplicates: true,
          });
        }
      }
    });

    await logAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      action: "admin.class.update",
      targetType: "class",
      targetId: id,
      summary: `Updated class "${nextName}".`,
      metadata: {
        code: nextCode,
        status: nextStatus,
        instructorCount: instructorIds?.length ?? null,
      },
    });

    return NextResponse.json({ ok: true });
});
