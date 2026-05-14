import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, type Session } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { groupDuplicateJobs } from "@/lib/job-board/duplicates";
import { buildSourceHealth, serializeScrapeRun } from "@/lib/job-board/scrape-status";
import { getJobSourceConfigurationStatus } from "@/lib/job-board/source-health";

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
    select: { id: true, sources: true, lastScrapedAt: true },
  });

  if (!config) {
    return NextResponse.json({
      latestRun: null,
      recentRuns: [],
      sourceHealth: getJobSourceConfigurationStatus(),
      activeJobCount: 0,
      lastScrapedAt: null,
    });
  }

  const [recentRuns, activeListings] = await Promise.all([
    prisma.jobScrapeRun.findMany({
      where: { classConfigId: config.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { sourceResults: { orderBy: { source: "asc" } } },
    }),
    prisma.jobListing.findMany({
      where: { classConfigId: config.id, status: "active" },
      select: { title: true, company: true, location: true, workMode: true, source: true, salaryMin: true, updatedAt: true },
    }),
  ]);
  const latestRun = recentRuns[0] ?? null;
  const sourceConfig = getJobSourceConfigurationStatus(config.sources);
  const activeJobCount = groupDuplicateJobs(activeListings).length;

  return NextResponse.json({
    latestRun: latestRun ? serializeScrapeRun(latestRun) : null,
    recentRuns: recentRuns.map(serializeScrapeRun),
    sourceHealth: buildSourceHealth(sourceConfig, recentRuns),
    activeJobCount,
    activeListingCount: activeListings.length,
    lastScrapedAt: config.lastScrapedAt?.toISOString() ?? null,
  });
});
