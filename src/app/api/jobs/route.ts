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
import { annotateJobsWithBands } from "@/lib/job-board/job-bands-response";
import { parseJobFilters, buildJobFilterWhere } from "@/lib/job-board/job-filters";
import { isJobWorkMode } from "@/lib/job-board/work-mode";
import { parseStoredResumeData } from "@/lib/resume";
import { loadBrowseJobs } from "@/lib/job-board/browse-jobs";
import { applicationStatusForJobBoard } from "@/lib/job-applications";

const VALID_PROXIMITY_FILTERS = new Set(["local", "remote", "all"]);

/**
 * VQ-R-017: saved-state markers come from the unified Application pipeline.
 * Applications join Opportunities; an Opportunity is deduped by url, so a
 * board row (class listing or browse row) is "saved" when the student has an
 * Application whose opportunity url matches the row's url.
 */
async function loadStudentApplicationsByUrl(studentId: string) {
  const applications = await prisma.application.findMany({
    where: { studentId },
    select: {
      status: true,
      notes: true,
      appliedAt: true,
      opportunity: { select: { url: true } },
    },
  });
  const byUrl = new Map<string, (typeof applications)[number]>();
  for (const application of applications) {
    if (application.opportunity.url) byUrl.set(application.opportunity.url, application);
  }
  return { applications, byUrl };
}

/**
 * GET /api/jobs
 *
 * Returns active job listings for the student's enrolled class,
 * with recommendation scores if the student has CareerDiscovery or resume skill data.
 * When no enrollment or class config exists, falls back to the program-wide browse pool.
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

  // Unified pipeline reads (VQ-R-017): both the class board and the browse
  // pool mark saved state from the student's Applications, matched by url.
  const { applications: studentApplications, byUrl: applicationsByUrl } =
    await loadStudentApplicationsByUrl(session.id);

  /**
   * Maps a JobBrowseListing row to the same response shape the UI consumes
   * for class-scoped JobListing rows. Browse jobs carry no personalization.
   */
  function mapBrowseRow(row: Awaited<ReturnType<typeof loadBrowseJobs>>[number]) {
    const saved = applicationsByUrl.get(row.url);
    return {
      ...row,
      listingKind: "browse" as const,
      savedStatus: saved ? applicationStatusForJobBoard(saved.status) : null,
      savedNotes: saved?.notes ?? null,
      savedAppliedAt: saved?.appliedAt?.toISOString() ?? null,
      matchScore: 0,
      matchLabel: null,
      clusterOverlap: [] as string[],
      skillOverlap: [] as string[],
      matchReasons: [] as unknown[],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      postedAt: row.postedAt?.toISOString() ?? null,
    };
  }

  /**
   * Fallback path: no enrollment or no class config.
   * Serve the browse pool so counts are always numeric and jobs still show.
   */
  async function browseOnlyResponse() {
    const browseRows = await loadBrowseJobs({
      proximity: proximityFilter,
      sort,
      searchParams: url.searchParams,
    });
    // Browse rows carry no recommendation and no discovery context → band: null.
    const jobs = annotateJobsWithBands(browseRows.map(mapBrowseRow), [], null);
    return NextResponse.json({
      jobs,
      hasDiscovery: false,
      hasResume: false,
      hasPersonalization: false,
      totalActive: jobs.length,
      totalLocal: 0,
      totalRemote: jobs.length,
      proximity: proximityFilter,
      totalSaved: studentApplications.length,
    });
  }

  // Find student's enrolled class
  const enrollment = await prisma.studentClassEnrollment.findFirst({
    where: { studentId: session.id, status: "active" },
    select: { classId: true },
  });

  if (!enrollment) {
    return browseOnlyResponse();
  }

  // Get class config
  const config = await prisma.jobClassConfig.findUnique({
    where: { classId: enrollment.classId },
  });

  if (!config) {
    return browseOnlyResponse();
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
  const classLocalCount = jobsWithProximity.filter((item) => item.proximity === "local").length;
  const classRemoteCount = jobsWithProximity.filter((item) => item.proximity === "remote").length;

  const filteredByProximity = jobsWithProximity.filter((item) => {
    if (proximityFilter === "all") return true;
    if (proximityFilter === "local") return item.proximity === "local";
    return item.proximity === "remote";
  });

  const classJobs = filteredByProximity
    .map((item) => item.job)
    .sort((a, b) => {
      if (sort === "salary") return (b.salaryMin ?? -1) - (a.salaryMin ?? -1);
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, 100);

  const [discovery, resumeRecord] = await Promise.all([
    prisma.careerDiscovery.findUnique({
      where: { studentId: session.id },
      select: { topClusters: true, hollandCode: true, transferableSkills: true },
    }),
    prisma.resumeData.findUnique({
      where: { studentId: session.id },
      select: { data: true },
    }),
  ]);

  const resume = resumeRecord ? parseStoredResumeData(resumeRecord.data) : null;
  const studentProfile = buildStudentJobProfile({
    resumeSkills: resume?.skills,
    resumeCertifications: resume?.certifications.map((cert) => cert.name),
    resumeExperienceTitles: resume?.experience.map((item) => item.title),
    discoverySkills: parseTransferableSkillNames(discovery?.transferableSkills),
  });
  // Interaction signals come from Applications matched (by opportunity url)
  // to this board's listings, which carry the clusters/company/source the
  // profile needs. Applications with no listing on the current board (e.g.
  // browse saves from a previous enrollment) simply contribute nothing.
  const interactionProfile = buildJobInteractionProfile(
    dedupedJobs.flatMap((jobRow) => {
      const application = applicationsByUrl.get(jobRow.url);
      return application
        ? [
            {
              status: applicationStatusForJobBoard(application.status),
              jobListing: {
                clusters: jobRow.clusters,
                company: jobRow.company,
                source: jobRow.source,
              },
            },
          ]
        : [];
    }),
  );
  const hasInteractionSignals =
    interactionProfile.preferredClusters.length > 0 ||
    interactionProfile.avoidedClusters.length > 0 ||
    interactionProfile.preferredCompanies.length > 0 ||
    interactionProfile.preferredSources.length > 0;
  const hasPersonalization = Boolean(discovery) || studentProfile.skills.length > 0 || hasInteractionSignals;

  // Score and rank class jobs
  const recommendations = rankJobs(classJobs, discovery, config.region, studentProfile, interactionProfile, priority);

  // Build response with saved status merged in (matched by opportunity url)
  const classJobsWithMeta = classJobs.map((job) => {
    const rec = recommendations.find((r) => r.jobListingId === job.id);
    const saved = applicationsByUrl.get(job.url);
    return {
      ...job,
      listingKind: "class" as const,
      savedStatus: saved ? applicationStatusForJobBoard(saved.status) : null,
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
      // JobListing has no postedAt; match the shape browse rows emit
      postedAt: null as string | null,
    };
  });

  // Re-sort class jobs by recommendation score if sort=recommended
  if (sort === "recommended" && hasPersonalization) {
    classJobsWithMeta.sort((a, b) => b.matchScore - a.matchScore);
  }

  // Merge browse-pool jobs into the Remote/All views.
  // Local tab always excludes browse jobs (browse pool is remote-only).
  // Dedup by source+sourceId against class jobs (class jobs take precedence).
  const classJobKeys = new Set(
    dedupedJobs.map((j) => `${j.source}:${j.sourceId}`),
  );

  const browseRows = await loadBrowseJobs({
    proximity: proximityFilter,
    sort,
    searchParams: url.searchParams,
  });

  const uniqueBrowseRows = browseRows.filter(
    (row) => !classJobKeys.has(`${row.source}:${row.sourceId}`),
  );
  const browseMapped = uniqueBrowseRows.map(mapBrowseRow);
  const browseRemoteCount = uniqueBrowseRows.length;

  // Combine: class jobs first (already ranked/sorted), then browse jobs appended.
  // The Local tab won't have browse jobs because loadBrowseJobs returns [] for proximity=local.
  // Band annotation is additive: class jobs (which have recommendations) get
  // core/stretch/wildcard from the same rankJobs() output; browse jobs get null.
  const jobs = annotateJobsWithBands(
    [...classJobsWithMeta, ...browseMapped],
    recommendations,
    discovery,
  );

  const totalLocal = classLocalCount;
  const totalRemote = classRemoteCount + browseRemoteCount;

  return NextResponse.json({
    jobs,
    hasDiscovery: !!discovery,
    hasResume: !!resumeRecord,
    hasPersonalization,
    totalActive: jobs.length,
    totalLocal,
    totalRemote,
    proximity: proximityFilter,
    totalSaved: studentApplications.length,
  });
});
