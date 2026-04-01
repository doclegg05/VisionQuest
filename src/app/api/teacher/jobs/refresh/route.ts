import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, notFound, rateLimited, type Session } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { enforceManualRefreshCooldown } from "@/lib/job-board/limits";
import { runScrapeForConfig } from "@/lib/job-board/scrape-engine";

/**
 * POST /api/teacher/jobs/refresh
 *
 * Manually trigger an opportunity scrape for a class config.
 * Body: { classId: string }
 */
export const POST = withTeacherAuth(async (session: Session, req: Request) => {
  const body = await req.json();
  const { classId } = body as { classId?: string };

  if (!classId) throw badRequest("classId is required");
  await assertStaffCanManageClass(session, classId);

  const refreshQuota = await enforceManualRefreshCooldown(classId);
  if (!refreshQuota.allowed) {
    throw rateLimited(
      `This class was refreshed recently. Try again in about ${refreshQuota.cooldownMinutes} minutes.`,
    );
  }

  const config = await prisma.jobClassConfig.findUnique({
    where: { classId },
    select: { id: true },
  });

  if (!config) throw notFound("No opportunity board config for this class");

  const totalJobs = await runScrapeForConfig(config.id);

  await logAuditEvent({
    action: "job_scrape.manual",
    actorId: session.id,
    targetType: "JobClassConfig",
    targetId: config.id,
    summary: `Manual opportunity refresh triggered for class ${classId} (${totalJobs} opportunities)`,
  });

  return NextResponse.json({
    refreshed: true,
    totalJobs,
    message: `Refreshed ${totalJobs} opportunit${totalJobs === 1 ? "y" : "ies"}`,
  });
});
