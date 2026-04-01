import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, notFound, type Session } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import { enqueueJob, processJobs } from "@/lib/jobs";
import "@/lib/jobs-registry";
import { logAuditEvent } from "@/lib/audit";

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

  const config = await prisma.jobClassConfig.findUnique({
    where: { classId },
    select: { id: true },
  });

  if (!config) throw notFound("No job board config for this class");

  const jobId = await enqueueJob({
    type: "scrape_jobs",
    payload: { configId: config.id },
    dedupeKey: `scrape:${config.id}`,
  });

  // Process inline for immediate feedback
  if (jobId) {
    await processJobs(1);
  }

  await logAuditEvent({
    action: "job_scrape.manual",
    actorId: session.id,
    targetType: "JobClassConfig",
    targetId: config.id,
    summary: `Manual job refresh triggered for class ${classId}`,
  });

  return NextResponse.json({ queued: !!jobId, message: jobId ? "Scrape started" : "Already in progress" });
});
