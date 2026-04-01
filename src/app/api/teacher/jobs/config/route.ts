import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, type Session } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit";
import { getAllSourceUsageSummaries, getManualRefreshStatus } from "@/lib/job-board/limits";
import { careerOneStopAdapter } from "@/lib/job-board/adapters/careeronestop";
import { jsearchAdapter } from "@/lib/job-board/adapters/jsearch";
import { usajobsAdapter } from "@/lib/job-board/adapters/usajobs";
import { adzunaAdapter } from "@/lib/job-board/adapters/adzuna";
import { normalizeProfileEntries } from "@/lib/job-board/profile";

const VALID_SOURCES = ["careeronestop", "jsearch", "usajobs", "adzuna"];
const SOURCE_STATUS = [
  {
    source: "careeronestop",
    label: "CareerOneStop Jobs (Official)",
    kind: "official",
    isConfigured: () => careerOneStopAdapter.isConfigured(),
  },
  {
    source: "jsearch",
    label: "JSearch (RapidAPI)",
    kind: "aggregator",
    isConfigured: () => jsearchAdapter.isConfigured(),
  },
  {
    source: "usajobs",
    label: "USAJobs (Federal)",
    kind: "official",
    isConfigured: () => usajobsAdapter.isConfigured(),
  },
  {
    source: "adzuna",
    label: "Adzuna",
    kind: "aggregator",
    isConfigured: () => adzunaAdapter.isConfigured(),
  },
] as const;

/**
 * GET /api/teacher/jobs/config?classId=xxx
 *
 * Returns the job board config for a class (or null if not configured).
 */
export const GET = withTeacherAuth(async (_session: Session, req: Request) => {
  const url = new URL(req.url);
  const classId = url.searchParams.get("classId");
  if (!classId) throw badRequest("classId is required");
  await assertStaffCanManageClass(_session, classId);

  const config = await prisma.jobClassConfig.findUnique({
    where: { classId },
  });

  const jobCount = config
    ? await prisma.jobListing.count({
        where: { classConfigId: config.id, status: "active" },
      })
    : 0;

  const [usage, manualRefresh] = await Promise.all([
    getAllSourceUsageSummaries(),
    getManualRefreshStatus(classId),
  ]);

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
    usage,
    manualRefresh,
    sourceStatus: SOURCE_STATUS.map((entry) => ({
      source: entry.source,
      label: entry.label,
      kind: entry.kind,
      configured: entry.isConfigured(),
      enabled: config?.sources.includes(entry.source) ?? false,
      recommended: entry.source === "careeronestop",
    })),
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
  const { classId, region, radius, sources, autoRefresh, targetRoles, excludedEmployers, remoteOnly, wageFloor } = body as {
    classId?: string;
    region?: string;
    radius?: number;
    sources?: string[];
    autoRefresh?: boolean;
    targetRoles?: string[];
    excludedEmployers?: string[];
    remoteOnly?: boolean;
    wageFloor?: number | null;
  };

  if (!classId || typeof classId !== "string") throw badRequest("classId is required");
  if (!region || typeof region !== "string") throw badRequest("region is required");
  await assertStaffCanManageClass(session, classId);

  // Validate sources
  const validatedSources = (sources ?? ["careeronestop"]).filter((s) => VALID_SOURCES.includes(s));
  if (validatedSources.length === 0) {
    throw badRequest(`At least one valid source required. Options: ${VALID_SOURCES.join(", ")}`);
  }
  const normalizedTargetRoles = normalizeProfileEntries(targetRoles);
  const normalizedExcludedEmployers = normalizeProfileEntries(excludedEmployers);
  const normalizedWageFloor =
    typeof wageFloor === "number" && Number.isFinite(wageFloor) && wageFloor > 0
      ? wageFloor
      : null;

  const config = await prisma.jobClassConfig.upsert({
    where: { classId },
    create: {
      classId,
      region,
      radius: radius ?? 25,
      sources: validatedSources,
      targetRoles: normalizedTargetRoles,
      excludedEmployers: normalizedExcludedEmployers,
      remoteOnly: remoteOnly ?? false,
      wageFloor: normalizedWageFloor,
      autoRefresh: autoRefresh ?? true,
    },
    update: {
      region,
      radius: radius ?? undefined,
      sources: validatedSources,
      targetRoles: normalizedTargetRoles,
      excludedEmployers: normalizedExcludedEmployers,
      remoteOnly: remoteOnly ?? false,
      wageFloor: normalizedWageFloor,
      autoRefresh: autoRefresh ?? undefined,
    },
  });

  await logAuditEvent({
    action: "job_config.update",
    actorId: session.id,
    targetType: "JobClassConfig",
    targetId: config.id,
    summary: `Updated job board config for class ${classId}: region=${region}, targetRoles=${normalizedTargetRoles.join(", ") || "none"}`,
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
