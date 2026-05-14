import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, notFound, type Session } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/jobs";
import "@/lib/jobs-registry";
import { logAuditEvent } from "@/lib/audit";
import { serializeScrapeRun } from "@/lib/job-board/scrape-status";

/**
 * POST /api/teacher/jobs/refresh
 *
 * Manually trigger a job scrape for a class config.
 * Body: { classId: string }
 */
export const POST = withTeacherAuth(async (session: Session, req: Request) => {
  const body = await req.json();
  const { classId } = body as { classId?: string };

  if (!classId) throw badRequest("classId is required");

  await assertStaffCanManageClass(session, classId);

  const config = await prisma.jobClassConfig.findUnique({
    where: { classId },
    select: { id: true },
  });

  if (!config) throw notFound("No job board config for this class");

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
    payload: { configId: config.id, scrapeRunId: scrapeRun.id },
    dedupeKey: `scrape:${config.id}`,
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
    summary: `Manual job refresh triggered for class ${classId}`,
  });

  return NextResponse.json({
    queued: true,
    message: "Scrape queued",
    run: serializeScrapeRun(runWithJob),
  });
});
