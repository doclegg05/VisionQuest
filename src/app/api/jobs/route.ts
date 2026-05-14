import { NextResponse } from "next/server";
import { withAuth, type Session } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import {
  buildJobInteractionProfile,
  buildStudentJobProfile,
  parseTransferableSkillNames,
  rankJobs,
} from "@/lib/job-board/recommendation";
import { parseStoredResumeData } from "@/lib/resume";

/**
 * GET /api/jobs
 *
 * Returns active job listings for the student's enrolled class,
 * with recommendation scores if the student has CareerDiscovery or resume skill data.
 *
 * Query params:
 *   cluster - filter by cluster ID
 *   sort    - "recommended" (default) | "recent" | "salary"
 */
export const GET = withAuth(async (session: Session, req: Request) => {
  const url = new URL(req.url);
  const clusterFilter = url.searchParams.get("cluster");
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

  // Fetch active jobs
  const where: Record<string, unknown> = {
    classConfigId: config.id,
    status: "active",
  };
  if (clusterFilter) {
    where.clusters = { has: clusterFilter };
  }

  const jobs = await prisma.jobListing.findMany({
    where,
    orderBy: sort === "salary"
      ? { salaryMin: "desc" }
      : { createdAt: "desc" },
    take: 100,
  });

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
  const recommendations = rankJobs(jobs, discovery, config.region, studentProfile, interactionProfile);

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
    totalSaved: savedJobs.length,
  });
});
