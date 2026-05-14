import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, type Session } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { groupDuplicateJobs } from "@/lib/job-board/duplicates";
import { DEFAULT_JOB_SOURCES, VALID_JOB_SOURCES, isValidJobSource } from "@/lib/job-board/source-options";

/**
 * GET /api/teacher/jobs/config?classId=xxx
 *
 * Returns the job board config for a class (or null if not configured).
 */
export const GET = withTeacherAuth(async (session: Session, req: Request) => {
  const url = new URL(req.url);
  const classId = url.searchParams.get("classId");
  if (!classId) throw badRequest("classId is required");

  await assertStaffCanManageClass(session, classId);

  const config = await prisma.jobClassConfig.findUnique({
    where: { classId },
  });

  const activeListings = config
    ? await prisma.jobListing.findMany({
        where: { classConfigId: config.id, status: "active" },
        select: { title: true, company: true, location: true, workMode: true, source: true, salaryMin: true, updatedAt: true },
      })
    : [];

  return NextResponse.json({
    config: config
      ? {
          ...config,
          lastScrapedAt: config.lastScrapedAt?.toISOString() ?? null,
          createdAt: config.createdAt.toISOString(),
          updatedAt: config.updatedAt.toISOString(),
        }
      : null,
    activeJobCount: groupDuplicateJobs(activeListings).length,
    activeListingCount: activeListings.length,
  });
});

/**
 * PUT /api/teacher/jobs/config
 *
 * Create or update job board config for a class.
 * Body: { classId, region, radius?, sources?, autoRefresh? }
 */
const VALID_LOCAL_JOB_PRIORITIES = ["prefer_local", "local_only", "balanced"] as const;
type LocalJobPriority = (typeof VALID_LOCAL_JOB_PRIORITIES)[number];
function isLocalJobPriority(value: unknown): value is LocalJobPriority {
  return typeof value === "string" && (VALID_LOCAL_JOB_PRIORITIES as readonly string[]).includes(value);
}

export const PUT = withTeacherAuth(async (session: Session, req: Request) => {
  const body = await req.json();
  const { classId, region, radius, sources, autoRefresh, localJobPriority } = body as {
    classId?: string;
    region?: string;
    radius?: number;
    sources?: string[];
    autoRefresh?: boolean;
    localJobPriority?: string;
  };

  if (!classId || typeof classId !== "string") throw badRequest("classId is required");
  if (!region || typeof region !== "string") throw badRequest("region is required");
  if (localJobPriority !== undefined && !isLocalJobPriority(localJobPriority)) {
    throw badRequest(`localJobPriority must be one of: ${VALID_LOCAL_JOB_PRIORITIES.join(", ")}`);
  }

  await assertStaffCanManageClass(session, classId);

  // Validate sources
  const validatedSources = (sources ?? [...DEFAULT_JOB_SOURCES]).filter(isValidJobSource);
  if (validatedSources.length === 0) {
    throw badRequest(`At least one valid source required. Options: ${VALID_JOB_SOURCES.join(", ")}`);
  }

  const config = await prisma.jobClassConfig.upsert({
    where: { classId },
    create: {
      classId,
      region,
      radius: radius ?? 25,
      sources: validatedSources,
      autoRefresh: autoRefresh ?? true,
      localJobPriority: localJobPriority ?? "prefer_local",
    },
    update: {
      region,
      radius: radius ?? undefined,
      sources: validatedSources,
      autoRefresh: autoRefresh ?? undefined,
      localJobPriority: localJobPriority ?? undefined,
    },
  });

  await logAuditEvent({
    action: "job_config.update",
    actorId: session.id,
    targetType: "JobClassConfig",
    targetId: config.id,
    summary: `Updated job board config for class ${classId}: region=${region}`,
  });

  return NextResponse.json({
    config: {
      ...config,
      lastScrapedAt: config.lastScrapedAt?.toISOString() ?? null,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    },
  });
});
