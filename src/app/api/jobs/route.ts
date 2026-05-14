import { NextResponse } from "next/server";
import { withAuth, type Session } from "@/lib/api-error";
import { prisma } from "@/lib/db";
import {
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
      select: { jobListingId: true, status: true },
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
  const savedMap = new Map(savedJobs.map((s) => [s.jobListingId, s.status]));

  const resume = resumeRecord ? parseStoredResumeData(resumeRecord.data) : null;
  const studentProfile = buildStudentJobProfile({
    resumeSkills: resume?.skills,
    resumeCertifications: resume?.certifications.map((cert) => cert.name),
    resumeExperienceTitles: resume?.experience.map((item) => item.title),
    discoverySkills: parseTransferableSkillNames(discovery?.transferableSkills),
  });
  const hasPersonalization = Boolean(discovery) || studentProfile.skills.length > 0;

  // Score and rank
  const recommendations = rankJobs(jobs, discovery, config.region, studentProfile);

  // Build response with saved status merged in
  const jobsWithMeta = jobs.map((job) => {
    const rec = recommendations.find((r) => r.jobListingId === job.id);
    return {
      ...job,
      savedStatus: savedMap.get(job.id) ?? null,
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
