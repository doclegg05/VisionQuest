import { NextResponse } from "next/server";
import { badRequest, conflict } from "@/lib/api-error";
import { withRegistry } from "@/lib/registry/middleware";
import { listManagedClasses, normalizeClassCode } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

function parseOptionalDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const GET = withRegistry("classes.list", async (session, req, ctx, tool) => {
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
      description: true,
      startDate: true,
      endDate: true,
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

  // Teachers and admins both get the full instructor list
  const availableInstructors = await prisma.student.findMany({
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

  return NextResponse.json({
    classes: classes.map((item) => ({
      ...item,
      instructors: item.instructors.map((entry) => entry.instructor),
      activeEnrollmentCount: item.enrollments.filter((enrollment) => enrollment.status !== "archived").length,
      archivedEnrollmentCount: item.enrollments.filter((enrollment) => enrollment.status === "archived").length,
    })),
    availableInstructors,
  });
});

export const POST = withRegistry("classes.create", async (session, req, ctx, tool) => {
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const code = normalizeClassCode(typeof body.code === "string" && body.code.trim() ? body.code : name);
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const instructorIds = Array.isArray(body.instructorIds)
    ? body.instructorIds.filter(
        (value: unknown): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  const startDate = parseOptionalDate(body.startDate);
  const endDate = parseOptionalDate(body.endDate);

  if (!name) {
    throw badRequest("Class name is required.");
  }
  if (!code) {
    throw badRequest("A class code is required.");
  }

  const existing = await prisma.spokesClass.findUnique({
    where: { code },
    select: { id: true },
  });
  if (existing) {
    throw conflict("That class code is already in use.");
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

  const createdClass = await prisma.spokesClass.create({
    data: {
      name,
      code,
      description: description || null,
      startDate,
      endDate,
      createdById: session.id,
      instructors: {
        create: instructorIds.map((instructorId: string) => ({
          instructorId,
        })),
      },
    },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
    },
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
      instructorCount: instructorIds.length,
    },
  });

  return NextResponse.json({ class: createdClass });
});
