import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, type Session } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";

const VALID_SOURCES = ["jsearch", "usajobs", "adzuna"];

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

  const jobCount = config
    ? await prisma.jobListing.count({
        where: { classConfigId: config.id, status: "active" },
      })
    : 0;

  return NextResponse.json({
    config: config
      ? {
          ...config,
          lastScrapedAt: config.lastScrapedAt?.toISOString() ?? null,
          createdAt: config.createdAt.toISOString(),
          updatedAt: config.updatedAt.toISOString(),
        }
      : null,
    activeJobCount: jobCount,
  });
});

/**
 * PUT /api/teacher/jobs/config
 *
 * Create or update job board config for a class.
 * Body: { classId, region, radius?, sources?, autoRefresh? }
 */
export const PUT = withTeacherAuth(async (session: Session, req: Request) => {
  const body = await req.json();
  const { classId, region, radius, sources, autoRefresh } = body as {
    classId?: string;
    region?: string;
    radius?: number;
    sources?: string[];
    autoRefresh?: boolean;
  };

  if (!classId || typeof classId !== "string") throw badRequest("classId is required");
  if (!region || typeof region !== "string") throw badRequest("region is required");

  await assertStaffCanManageClass(session, classId);

  // Validate sources
  const validatedSources = (sources ?? ["jsearch"]).filter((s) => VALID_SOURCES.includes(s));
  if (validatedSources.length === 0) {
    throw badRequest(`At least one valid source required. Options: ${VALID_SOURCES.join(", ")}`);
  }

  const config = await prisma.jobClassConfig.upsert({
    where: { classId },
    create: {
      classId,
      region,
      radius: radius ?? 25,
      sources: validatedSources,
      autoRefresh: autoRefresh ?? true,
    },
    update: {
      region,
      radius: radius ?? undefined,
      sources: validatedSources,
      autoRefresh: autoRefresh ?? undefined,
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
