import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, conflict, forbidden } from "@/lib/api-error";
import {
  assertStaffCanManageClass,
  assertTeacherAssignmentLimit,
  normalizeClassCode,
  normalizeInstructorIds,
} from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { isProgramType } from "@/lib/program-type";
import { assertRegionAllowed } from "@/lib/class-create";
import { seesWholeState } from "@/lib/org-roles";
import { countInstructorsInRegion } from "@/lib/region";
import { parseBody, updateClassSchema } from "@/lib/schemas";

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
      programType: true,
      description: true,
      startDate: true,
      endDate: true,
      // Readable by any signed-in user under RLS region_read; the caller can
      // already manage this class, so this adds only which region it is in.
      regionId: true,
      region: { select: { id: true, name: true } },
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
    const body = await parseBody(req, updateClassSchema);

    const existing = await prisma.spokesClass.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        regionId: true,
        instructors: {
          select: {
            instructorId: true,
          },
        },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    await assertStaffCanManageClass(session, id);

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

    let nextProgramType: string | undefined;
    if (body.programType !== undefined) {
      if (!isProgramType(body.programType)) {
        throw badRequest(
          "programType must be one of: spokes, adult_ed, ietp.",
        );
      }
      nextProgramType = body.programType;
    }

    let nextRegionId: string | null | undefined;
    if (body.regionId !== undefined) {
      if (body.regionId === null) {
        // Creating a class requires a region, and a regionless class is hidden
        // from the regional coordinator. Only whole-state roles may unset it.
        if (!seesWholeState(session.role)) {
          throw forbidden("Only an admin can remove a class from its region.");
        }
        nextRegionId = null;
      } else if (body.regionId.trim()) {
        // Moving a class takes it from one region's coordinators and shows
        // every enrolled student's records to another's, so only an admin may
        // change the region. An instructor may be placed in two regions, and
        // assertRegionAllowed alone would let them move a class between the
        // two. Repeating the class's current region is not a move.
        if (body.regionId !== existing.regionId && session.role !== "admin") {
          throw forbidden("Only an admin can move a class to another region.");
        }
        // Still needed for the admin: the region must exist and be active.
        await assertRegionAllowed(session, body.regionId);
        nextRegionId = body.regionId;
      } else {
        throw badRequest("regionId must be a non-empty string or null.");
      }
    }
    const instructorIds = body.instructorIds
      ? normalizeInstructorIds(body.instructorIds.filter((value) => value.trim().length > 0))
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

    const nextInstructorIds = instructorIds ?? existing.instructors.map((entry) => entry.instructorId);
    // The same rule as creating a class: an instructor's co-teachers must be in
    // the class's region, checked against the region it is moving to.
    if (!seesWholeState(session.role) && (instructorIds || nextRegionId !== undefined)) {
      const regionId = nextRegionId !== undefined ? nextRegionId : existing.regionId;
      const others = nextInstructorIds.filter((instructorId) => instructorId !== session.id);
      if (regionId && others.length > 0 && (await countInstructorsInRegion(regionId, others)) !== others.length) {
        throw badRequest("Co-teachers must be in the same region.");
      }
    }
    await assertTeacherAssignmentLimit(nextInstructorIds, {
      excludeClassId: id,
      targetClassStatus: nextStatus,
    });

    await prisma.$transaction(async (tx) => {
      await tx.spokesClass.update({
        where: { id },
        data: {
          name: nextName,
          code: nextCode,
          status: nextStatus,
          ...(nextProgramType !== undefined ? { programType: nextProgramType } : {}),
          ...(nextRegionId !== undefined ? { regionId: nextRegionId } : {}),
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
            data: instructorIds.map((instructorId) => ({
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
        previousRegionId: existing.regionId,
        regionId: nextRegionId !== undefined ? nextRegionId : existing.regionId,
      },
    });

    return NextResponse.json({ ok: true });
});
