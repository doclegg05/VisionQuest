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
import {
  loadHiddenVacancyKeys,
  loadSavedJobsForBoard,
  resolveBoardConfig,
} from "@/lib/job-board/job-preferences";
import { buildSavedLookup, savedMetaFor, toInteractionInputs, type SavedLookup } from "@/lib/job-board/saved-job-lookup";
import { excludeHiddenVacancies } from "@/lib/job-board/vacancy-identity";

const VALID_PROXIMITY_FILTERS = new Set(["local", "remote", "all"]);

/**
 * GET /api/jobs
 *
 * Returns active job listings for the student's enrolled class,
 * with recommendation scores if the student has CareerDiscovery or resume skill data.
 * When no enrollment or class config exists, falls back to the program-wide browse pool.
 *
 * W4 (2026-11-09): the board class is the most recent active enrollment with
 * a job setup (resolveBoardConfig). Vacancies the student marked "Not
 * interested" are left out of both pools before display grouping, and saved
 * status attaches by vacancy key, so it shows on reimported rows and on
 * browse rows too. Queries live in src/lib/job-board/job-preferences.ts.
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

  /**
   * Maps a JobBrowseListing row to the same response shape the UI consumes
   * for class-scoped JobListing rows. Browse jobs carry no personalization.
   */
  function mapBrowseRow(row: Awaited<ReturnType<typeof loadBrowseJobs>>[number], saved: SavedLookup) {
    return {
      ...row,
      ...savedMetaFor(saved, row),
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
    const [browseRows, hiddenKeys, savedJobs] = await Promise.all([
      loadBrowseJobs({ proximity: proximityFilter, sort, searchParams: url.searchParams }),
      loadHiddenVacancyKeys(session.id),
      loadSavedJobsForBoard(session.id),
    ]);
    const saved = buildSavedLookup(savedJobs);
    const visibleRows = excludeHiddenVacancies(browseRows, hiddenKeys);
    // Browse rows carry no recommendation and no discovery context → band: null.
    const jobs = annotateJobsWithBands(visibleRows.map((row) => mapBrowseRow(row, saved)), [], null);
    return NextResponse.json({
      jobs,
      hasDiscovery: false,
      hasResume: false,
      hasPersonalization: false,
      totalActive: jobs.length,
      totalLocal: 0,
      totalRemote: jobs.length,
      proximity: proximityFilter,
      totalSaved: savedJobs.length,
    });
  }

  const config = await resolveBoardConfig(session.id);
  if (!config) {
    return browseOnlyResponse();
  }
  const hiddenKeys = await loadHiddenVacancyKeys(session.id);

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
      ? { salaryMin: { sort: "desc", nulls: "last" } }
      : { createdAt: "desc" },
    take: 500,
  });
  // Hidden vacancies go first, so a hidden opening never stands in for a
  // visible look-alike in display grouping.
  const dedupedJobs = dedupeJobsForDisplay(excludeHiddenVacancies(activeJobs, hiddenKeys));

  // Classify proximity for every deduped job so the UI can show accurate counts
  // on the Local/Remote toggle even when one section is hidden.
  const jobsWithProximity = dedupedJobs.map((job) => ({
    job,
    proximity: classifyJobProximity(job, config.region),
  })).filter((item) => priority !== "local_only" || item.proximity === "local");
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
    });

  const [savedJobs, discovery, resumeRecord] = await Promise.all([
    loadSavedJobsForBoard(session.id),
    prisma.careerDiscovery.findUnique({
      where: { studentId: session.id },
      select: { topClusters: true, hollandCode: true, transferableSkills: true },
    }),
    prisma.resumeData.findUnique({
      where: { studentId: session.id },
      select: { data: true },
    }),
  ]);
  const saved = buildSavedLookup(savedJobs);

  const resume = resumeRecord ? parseStoredResumeData(resumeRecord.data) : null;
  const studentProfile = buildStudentJobProfile({
    resumeSkills: resume?.skills,
    resumeCertifications: resume?.certifications.map((cert) => cert.name),
    resumeExperienceTitles: resume?.experience.map((item) => item.title),
    discoverySkills: parseTransferableSkillNames(discovery?.transferableSkills),
  });
  const interactionProfile = buildJobInteractionProfile(toInteractionInputs(savedJobs));
  const hasInteractionSignals =
    interactionProfile.preferredClusters.length > 0 ||
    interactionProfile.avoidedClusters.length > 0 ||
    interactionProfile.preferredCompanies.length > 0 ||
    interactionProfile.preferredSources.length > 0;
  const hasPersonalization = Boolean(discovery) || studentProfile.skills.length > 0 || hasInteractionSignals;

  // Score and rank class jobs
  const recommendations = rankJobs(classJobs, discovery, config.region, studentProfile, interactionProfile, priority);

  // Build response with saved status merged in (class jobs only)
  const classJobsWithMeta = classJobs.map((job) => {
    const rec = recommendations.find((r) => r.jobListingId === job.id);
    return {
      ...job,
      ...savedMetaFor(saved, job),
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
  const displayedClassJobs = classJobsWithMeta.slice(0, 100);

  // Merge browse-pool jobs into the Remote/All views.
  // Local tab always excludes browse jobs (browse pool is remote-only).
  // Dedup by source+sourceId against class jobs (class jobs take precedence).
  const classJobKeys = new Set(
    dedupedJobs.map((j) => `${j.source}:${j.sourceId}`),
  );

  const browseRows = priority === "local_only" ? [] : await loadBrowseJobs({
    // Count the remote pool even while the Local tab is selected.
    proximity: "remote",
    sort,
    searchParams: url.searchParams,
  });

  const uniqueBrowseRows = excludeHiddenVacancies(browseRows, hiddenKeys).filter(
    (row) => !classJobKeys.has(`${row.source}:${row.sourceId}`),
  );
  const browseMapped = proximityFilter === "local" ? [] : uniqueBrowseRows.map((row) => mapBrowseRow(row, saved));
  const browseRemoteCount = uniqueBrowseRows.length;

  // Combine: class jobs first (already ranked/sorted), then browse jobs appended.
  // The Local tab counts the browse pool but does not display it.
  // Band annotation is additive: class jobs (which have recommendations) get
  // core/stretch/wildcard from the same rankJobs() output; browse jobs get null.
  const jobs = annotateJobsWithBands(
    [...displayedClassJobs, ...browseMapped],
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
    totalSaved: savedJobs.length,
  });
});
