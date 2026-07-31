import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { listManagedStudentIds } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { computeAcademicKpis } from "@/lib/academic-kpi";

export const GET = withTeacherAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const classId = url.searchParams.get("classId") ?? undefined;

  const studentIds = await listManagedStudentIds(session, {
    classId,
    includeInactiveAccounts: true,
  });

  if (studentIds.length === 0) {
    return NextResponse.json(computeAcademicKpis([], new Date(), 0));
  }

  const [students, orientationTotal] = await Promise.all([
    prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        createdAt: true,
        conversations: {
          select: { createdAt: true },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
        goals: {
          select: {
            id: true,
            level: true,
            status: true,
            createdAt: true,
            resourceLinks: {
              select: {
                id: true,
                linkType: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
        progression: {
          select: { state: true },
        },
        certifications: {
          select: { status: true, startedAt: true, completedAt: true },
        },
        portfolioItems: { select: { id: true } },
        resumeData: { select: { id: true } },
        publicCredentialPage: { select: { isPublic: true } },
        // Readiness denominator convention: ALL orientation items count, not
        // just required ones — matches fetch-readiness-data, class-progress,
        // teacher/dashboard, reporting, export, and coaching-arcs.
        orientationProgress: {
          where: { completed: true },
          select: { itemId: true },
        },
      },
    }),
    prisma.orientationItem.count(),
  ]);

  const rows = students.map((s) => ({
    ...s,
    progressionState: s.progression?.state ?? null,
  }));

  return NextResponse.json(computeAcademicKpis(rows, new Date(), orientationTotal));
});
