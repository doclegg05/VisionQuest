import { NextResponse } from "next/server";
import { badRequest, type Session } from "@/lib/api-error";
import { parseBody, createClassSchema } from "@/lib/schemas";
import { countInstructorsInRegion, listRegionsForClassCreation } from "@/lib/region";
import { assertRegionAllowed, createClassWithInstructors } from "@/lib/class-create";
import { seesWholeState } from "@/lib/org-roles";
import { withRegistry } from "@/lib/registry/middleware";
import {
  listManagedClasses,
  normalizeClassCode,
  normalizeInstructorIds,
} from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { isDemoInstructor } from "@/lib/demo/guards";
import { logAuditEvent } from "@/lib/audit";

function parseOptionalDate(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const GET = withRegistry("classes.list", async (session, req, _ctx, _tool) => {
  const { searchParams } = new URL(req.url);
  const includeArchived = searchParams.get("includeArchived") === "true";

  const classes = await prisma.spokesClass.findMany({
    where: {
      id: {
        in: (await listManagedClasses(session, { includeArchived })).map((item) => item.id),
      },
    },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      programType: true,
      description: true,
      startDate: true,
      endDate: true,
      // Region names are readable by every signed-in user (RLS region_read),
      // so this adds only which region each listed class is in.
      regionId: true,
      region: { select: { id: true, name: true } },
      instructors: {
        select: {
          instructor: {
            select: {
              id: true,
              displayName: true,
              email: true,
              role: true,
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
        },
      },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  // Teachers and admins both get the full instructor list. The demo instructor
  // does not: that list is real people's names and emails, and a visitor to
  // the demo has no use for it.
  const availableInstructors = isDemoInstructor(session)
    ? []
    : await prisma.student.findMany({
        where: {
          role: "teacher",
          isActive: true,
        },
        select: {
          id: true,
          studentId: true,
          displayName: true,
          email: true,
        },
        orderBy: { displayName: "asc" },
      });

  const regions = await listRegionsForClassCreation(session);

  return NextResponse.json({
    viewerRole: session.role,
    currentInstructorId: session.role === "teacher" ? session.id : null,
    regions,
    classes: classes.map((item) => ({
      ...item,
      instructors: item.instructors.map((entry) => entry.instructor),
      activeEnrollmentCount: item.enrollments.filter((enrollment) => enrollment.status !== "archived").length,
      archivedEnrollmentCount: item.enrollments.filter((enrollment) => enrollment.status === "archived").length,
    })),
    availableInstructors,
  });
});

async function assertCoTeachersInRegion(session: Session, regionId: string, instructorIds: string[]) {
  if (!seesWholeState(session.role) && !instructorIds.includes(session.id)) {
    throw badRequest("Add yourself as an instructor of this class.");
  }
  const others = instructorIds.filter((id) => id !== session.id);
  if (others.length === 0) return;
  const inRegion = await countInstructorsInRegion(regionId, others);
  if (inRegion !== others.length) throw badRequest("Co-teachers must be in the same region.");
}

export const POST = withRegistry("classes.create", async (session, req, _ctx, _tool) => {
  const input = await parseBody(req, createClassSchema);
  const name = input.name;
  const code = normalizeClassCode(input.code?.trim() ? input.code : name);
  const description = input.description?.trim() ?? "";
  const instructorIds = normalizeInstructorIds(input.instructorIds);
  const startDate = parseOptionalDate(input.startDate);
  const endDate = parseOptionalDate(input.endDate);
  const { programType, regionId } = input;

  await assertRegionAllowed(session, regionId);
  await assertCoTeachersInRegion(session, regionId, instructorIds);

  if (!code) {
    throw badRequest("A class code is required.");
  }

  if (instructorIds.length > 0) {
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

  // Every check above has passed; the insert goes through prismaAdmin because
  // RLS cannot admit a class before its instructor rows exist (Ruling R19).
  const createdClass = await createClassWithInstructors({
    name,
    code,
    programType,
    regionId,
    description: description || null,
    startDate,
    endDate,
    createdById: session.id,
    instructorIds,
  });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.class.create",
    targetType: "class",
    targetId: createdClass.id,
    summary: `Created class "${createdClass.name}".`,
    metadata: {
      code: createdClass.code,
      programType: createdClass.programType,
      instructorCount: instructorIds.length,
    },
  });

  return NextResponse.json({ class: createdClass });
});
