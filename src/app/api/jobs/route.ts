import { NextResponse } from "next/server";
import { withAuth, type Session } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import {
  buildJobInteractionProfile,
  buildStudentJobProfile,
  classifyJobProximity,
  parseTransferableSkillNames,
  rankJobs,
  type LocalJobPriority,
} from "@/lib/job-board/recommendation";
import { dedupeJobsForDisplay } from "@/lib/job-board/duplicates";
import { parseJobFilters, buildJobFilterWhere } from "@/lib/job-board/job-filters";
import { isJobWorkMode } from "@/lib/job-board/work-mode";
import { parseStoredResumeData } from "@/lib/resume";

const VALID_PROXIMITY_FILTERS = new Set(["local", "remote", "all"]);

/**
 * GET /api/jobs
 *
 * Returns active job listings for the student's enrolled class,
 * with recommendation scores if the student has CareerDiscovery or resume skill data.
 *
 * Query params:
 *   cluster   - filter by cluster ID
 *   workMode  - "onsite" | "remote" | "hybrid" (legacy filter, kept for back-compat)
 *   proximity - "local" | "remote" | "all" (default "local"); filters by computed
 *               proximity to the class region — see classifyJobProximity().
 *   sort      - "recommended" (default) | "recent" | "salary"
 */
export const GET = withAuth(async (session: Session, req: Request) => {
  const url = new URL(req.url);
  const clusterFilter = url.searchParams.get("cluster");
  const workModeFilter = url.searchParams.get("workMode");
  const proximityFilterRaw = url.searchParams.get("proximity") ?? "local";
  const proximityFilter = VALID_PROXIMITY_FILTERS.has(proximityFilterRaw)
    ? (proximityFilterRaw as "local" | "remote" | "all")
    : "local";
  const sort = url.searchParams.get("sort") ?? "recommended";

  // Find student's enrolled class
  const enrollment = await prisma.studentClassEnrollment.findFirst({
    where: { studentId: session.id, status: "active" },
    select: { classId: true },
  });

  if (!enrollment) {
    return NextResponse.json({ jobs: [], recommendations: [], hasDiscovery: false });
  }

  // Get class config
  const config = await prisma.jobClassConfig.findUnique({
    where: { classId: enrollment.classId },
  });

  if (!config) {
    return NextResponse.json({ jobs: [], recommendations: [], hasDiscovery: false });
  }

  const priority = (config.localJobPriority ?? "prefer_local") as LocalJobPriority;

  // Fetch active jobs
  const where: Record<string, unknown> = {
    classConfigId: config.id,
    status: "active",
  };
  if (clusterFilter) {
    where.clusters = { has: clusterFilter };
  }
  if (isJobWorkMode(workModeFilter)) {
    where.workMode = workModeFilter;
  } else if (priority === "local_only") {
    // Teacher has chosen to hide remote roles entirely for this class.
    // Hybrid is kept because in-region hybrid roles still classify as "local".
    where.workMode = { not: "remote" };
  }

  const filters = parseJobFilters(url.searchParams);
  Object.assign(where, buildJobFilterWhere(filters, new Date()));

  const activeJobs = await prisma.jobListing.findMany({
    where,
    orderBy: sort === "salary"
      ? { salaryMin: "desc" }
      : { createdAt: "desc" },
    take: 500,
  });
  const dedupedJobs = dedupeJobsForDisplay(activeJobs);

  // Classify proximity for every deduped job so the UI can show accurate counts
  // on the Local/Remote toggle even when one section is hidden.
  const jobsWithProximity = dedupedJobs.map((job) => ({
    job,
    proximity: classifyJobProximity(job, config.region),
  }));
  const totalLocal = jobsWithProximity.filter((item) => item.proximity === "local").length;
  const totalRemote = jobsWithProximity.filter((item) => item.proximity === "remote").length;

  const filteredByProximity = jobsWithProximity.filter((item) => {
    if (proximityFilter === "all") return true;
    if (proximityFilter === "local") return item.proximity === "local";
    return item.proximity === "remote";
  });

  const jobs = filteredByProximity
    .map((item) => item.job)
    .sort((a, b) => {
      if (sort === "salary") return (b.salaryMin ?? -1) - (a.salaryMin ?? -1);
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, 100);

  const [savedJobs, discovery, resumeRecord] = await Promise.all([
    prisma.studentSavedJob.findMany({
      where: { studentId: session.id },
      select: {
        jobListingId: true,
        status: true,
        notes: true,
        appliedAt: true,
        jobListing: {
          select: {
            clusters: true,
            company: true,
            source: true,
          },
        },
      },
    }),
    prisma.careerDiscovery.findUnique({
      where: { studentId: session.id },
      select: { topClusters: true, hollandCode: true, transferableSkills: true },
    }),
    prisma.resumeData.findUnique({
      where: { studentId: session.id },
      select: { data: true },
    }),
  ]);
  const savedMap = new Map(savedJobs.map((s) => [s.jobListingId, s]));

  const resume = resumeRecord ? parseStoredResumeData(resumeRecord.data) : null;
  const studentProfile = buildStudentJobProfile({
    resumeSkills: resume?.skills,
    resumeCertifications: resume?.certifications.map((cert) => cert.name),
    resumeExperienceTitles: resume?.experience.map((item) => item.title),
    discoverySkills: parseTransferableSkillNames(discovery?.transferableSkills),
  });
  const interactionProfile = buildJobInteractionProfile(savedJobs);
  const hasInteractionSignals =
    interactionProfile.preferredClusters.length > 0 ||
    interactionProfile.avoidedClusters.length > 0 ||
    interactionProfile.preferredCompanies.length > 0 ||
    interactionProfile.preferredSources.length > 0;
  const hasPersonalization = Boolean(discovery) || studentProfile.skills.length > 0 || hasInteractionSignals;

  // Score and rank
  const recommendations = rankJobs(jobs, discovery, config.region, studentProfile, interactionProfile, priority);

  // Build response with saved status merged in
  const jobsWithMeta = jobs.map((job) => {
    const rec = recommendations.find((r) => r.jobListingId === job.id);
    const saved = savedMap.get(job.id);
    return {
      ...job,
      savedStatus: saved?.status ?? null,
      savedNotes: saved?.notes ?? null,
      savedAppliedAt: saved?.appliedAt?.toISOString() ?? null,
      matchScore: rec?.score ?? 0,
      matchLabel: rec?.matchLabel ?? null,
      clusterOverlap: rec?.clusterOverlap ?? [],
      skillOverlap: rec?.skillOverlap ?? [],
      matchReasons: rec?.matchReasons ?? [],
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      expiresAt: job.expiresAt?.toISOString() ?? null,
    };
  });

  // Re-sort by recommendation score if sort=recommended
  if (sort === "recommended" && hasPersonalization) {
    jobsWithMeta.sort((a, b) => b.matchScore - a.matchScore);
  }

  return NextResponse.json({
    jobs: jobsWithMeta,
    hasDiscovery: !!discovery,
    hasResume: !!resumeRecord,
    hasPersonalization,
    totalActive: jobs.length,
    totalLocal,
    totalRemote,
    proximity: proximityFilter,
    totalSaved: savedJobs.length,
  });
});
