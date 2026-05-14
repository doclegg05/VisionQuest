import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, type Session } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { serializeScrapeRun } from "@/lib/job-board/scrape-status";

/**
 * GET /api/teacher/jobs/status?classId=xxx
 *
 * Returns the latest Job Scout scrape run for a class, including per-source
 * status. This lets the teacher UI poll without blocking on external job sites.
 */
export const GET = withTeacherAuth(async (session: Session, req: Request) => {
  const url = new URL(req.url);
  const classId = url.searchParams.get("classId");
  if (!classId) throw badRequest("classId is required");

  await assertStaffCanManageClass(session, classId);

  const config = await prisma.jobClassConfig.findUnique({
    where: { classId },
    select: { id: true },
  });

  if (!config) {
    return NextResponse.json({
      latestRun: null,
      activeJobCount: 0,
    });
  }

  const [latestRun, activeJobCount] = await Promise.all([
    prisma.jobScrapeRun.findFirst({
      where: { classConfigId: config.id },
      orderBy: { createdAt: "desc" },
      include: { sourceResults: { orderBy: { source: "asc" } } },
    }),
    prisma.jobListing.count({
      where: { classConfigId: config.id, status: "active" },
    }),
  ]);

  return NextResponse.json({
    latestRun: latestRun ? serializeScrapeRun(latestRun) : null,
    activeJobCount,
  });
});
