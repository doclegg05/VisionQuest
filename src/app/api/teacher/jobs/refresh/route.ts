import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, notFound, type Session } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import "@/lib/jobs-registry";
import { logAuditEvent } from "@/lib/audit";
import { serializeScrapeRun } from "@/lib/job-board/scrape-status";
import { isValidJobSource } from "@/lib/job-board/source-options";

/**
 * POST /api/teacher/jobs/refresh
 *
 * Manually trigger a job scrape for a class config.
 * Body: { classId: string, sources?: string[] }
 */
export const POST = withTeacherAuth(async (session: Session, req: Request) => {
  const body = await req.json();
  const { classId, sources } = body as { classId?: string; sources?: unknown };

  if (!classId) throw badRequest("classId is required");

  await assertStaffCanManageClass(session, classId);

  const config = await prisma.jobClassConfig.findUnique({
    where: { classId },
    select: { id: true, sources: true },
  });

  if (!config) throw notFound("No job board config for this class");

  const requestedSources = Array.isArray(sources)
    ? sources.filter((source): source is string => typeof source === "string")
    : [];
  const sourceAllowlist = requestedSources
    .filter(isValidJobSource)
    .filter((source) => config.sources.includes(source));
  if (requestedSources.length > 0 && sourceAllowlist.length === 0) {
    throw badRequest("No requested job sources are enabled for this class");
  }
  const sortedSourceAllowlist = [...new Set(sourceAllowlist)].sort();

  const existingRun = await prisma.jobScrapeRun.findFirst({
    where: {
      classConfigId: config.id,
      status: { in: ["queued", "processing"] },
    },
    orderBy: { createdAt: "desc" },
    include: { sourceResults: { orderBy: { source: "asc" } } },
  });

  if (existingRun) {
    return NextResponse.json({
      queued: false,
      message: "Scrape already in progress",
      run: serializeScrapeRun(existingRun),
    });
  }

  const scrapeRun = await prisma.jobScrapeRun.create({
    data: {
      classConfigId: config.id,
      trigger: "manual",
      status: "queued",
      requestedById: session.id,
    },
    include: { sourceResults: true },
  });

  const jobId = await enqueueJob({
    type: "scrape_jobs",
    payload: {
      configId: config.id,
      scrapeRunId: scrapeRun.id,
      sources: sortedSourceAllowlist.length > 0 ? sortedSourceAllowlist : undefined,
    },
    dedupeKey: sortedSourceAllowlist.length > 0
      ? `scrape:${config.id}:${sortedSourceAllowlist.join(",")}`
      : `scrape:${config.id}`,
  });

  const runWithJob = await prisma.jobScrapeRun.update({
    where: { id: scrapeRun.id },
    data: { backgroundJobId: jobId },
    include: { sourceResults: { orderBy: { source: "asc" } } },
  });

  await logAuditEvent({
    action: "job_scrape.manual",
    actorId: session.id,
    targetType: "JobClassConfig",
    targetId: config.id,
    summary: sortedSourceAllowlist.length > 0
      ? `Manual job refresh triggered for class ${classId} sources ${sortedSourceAllowlist.join(", ")}`
      : `Manual job refresh triggered for class ${classId}`,
  });

  return NextResponse.json({
    queued: true,
    message: "Scrape queued",
    run: serializeScrapeRun(runWithJob),
  });
});
