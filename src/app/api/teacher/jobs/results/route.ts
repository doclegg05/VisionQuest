import { NextResponse } from "next/server";
import { withTeacherAuth, badRequest, type Session } from "@/lib/api-error";
import { assertStaffCanManageClass } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import { groupDuplicateJobs } from "@/lib/job-board/duplicates";
import { JOB_SOURCE_OPTIONS } from "@/lib/job-board/source-options";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

const SOURCE_LABELS = new Map<string, string>(
  JOB_SOURCE_OPTIONS.map((source) => [source.value, source.label]),
);

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function searchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function jobMatchesQuery(
  job: { title: string; company: string; location: string; description: string; source: string },
  query: string,
): boolean {
  if (!query) return true;
  return searchText([job.title, job.company, job.location, job.description, job.source].join(" ")).includes(query);
}

/**
 * GET /api/teacher/jobs/results?classId=xxx
 *
 * Returns the active jobs found for a teacher-managed class. Duplicate postings
 * from multiple sources are grouped so the teacher sees one role with all
 * contributing sources attached.
 */
export const GET = withTeacherAuth(async (session: Session, req: Request) => {
  const url = new URL(req.url);
  const classId = url.searchParams.get("classId");
  if (!classId) throw badRequest("classId is required");

  await assertStaffCanManageClass(session, classId);

  const config = await prisma.jobClassConfig.findUnique({
    where: { classId },
    select: { id: true },
  });

  if (!config) {
    return NextResponse.json({
      jobs: [],
      sourceOptions: [],
      totalListings: 0,
      totalUnique: 0,
      filteredUnique: 0,
      duplicateGroups: 0,
      duplicateListings: 0,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      totalPages: 0,
    });
  }

  const query = searchText(url.searchParams.get("q") ?? "");
  const sourceFilter = url.searchParams.get("source") ?? "";
  const clusterFilter = url.searchParams.get("cluster") ?? "";
  const sort = url.searchParams.get("sort") ?? "recent";
  const pageSize = Math.min(parsePositiveInt(url.searchParams.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const page = parsePositiveInt(url.searchParams.get("page"), 1);

  const listings = await prisma.jobListing.findMany({
    where: { classConfigId: config.id, status: "active" },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      salary: true,
      salaryMin: true,
      description: true,
      url: true,
      source: true,
      sourceType: true,
      sourceId: true,
      clusters: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { savedByStudents: true } },
    },
  });

  const groups = groupDuplicateJobs(listings);
  const duplicateGroups = groups.filter((group) => group.jobs.length > 1).length;
  const duplicateListings = groups.reduce((count, group) => count + Math.max(0, group.jobs.length - 1), 0);
  const sourceOptions = [...new Set(listings.map((job) => job.source))]
    .sort()
    .map((source) => ({ value: source, label: SOURCE_LABELS.get(source) ?? source }));

  const filtered = groups
    .filter((group) => !sourceFilter || group.sources.includes(sourceFilter))
    .filter((group) => !clusterFilter || group.jobs.some((job) => job.clusters.includes(clusterFilter)))
    .filter((group) => group.jobs.some((job) => jobMatchesQuery(job, query)));

  filtered.sort((a, b) => {
    if (sort === "salary") {
      return (b.primary.salaryMin ?? -1) - (a.primary.salaryMin ?? -1);
    }
    if (sort === "company") {
      return a.primary.company.localeCompare(b.primary.company);
    }
    if (sort === "title") {
      return a.primary.title.localeCompare(b.primary.title);
    }
    return b.primary.updatedAt.getTime() - a.primary.updatedAt.getTime();
  });

  const totalPages = filtered.length > 0 ? Math.ceil(filtered.length / pageSize) : 0;
  const safePage = totalPages > 0 ? Math.min(page, totalPages) : 1;
  const start = (safePage - 1) * pageSize;

  return NextResponse.json({
    jobs: filtered.slice(start, start + pageSize).map((group) => {
      const primary = group.primary;
      const savedCount = group.jobs.reduce((count, job) => count + job._count.savedByStudents, 0);

      return {
        id: primary.id,
        title: primary.title,
        company: primary.company,
        location: primary.location,
        salary: primary.salary,
        salaryMin: primary.salaryMin,
        description: primary.description.length > 240
          ? `${primary.description.slice(0, 240).trim()}...`
          : primary.description,
        url: primary.url,
        source: primary.source,
        sourceLabel: SOURCE_LABELS.get(primary.source) ?? primary.source,
        sources: group.sources.map((source) => ({
          value: source,
          label: SOURCE_LABELS.get(source) ?? source,
        })),
        duplicateCount: group.jobs.length,
        sourceCount: group.sources.length,
        clusters: [...new Set(group.jobs.flatMap((job) => job.clusters))],
        savedCount,
        createdAt: primary.createdAt.toISOString(),
        updatedAt: primary.updatedAt.toISOString(),
      };
    }),
    sourceOptions,
    totalListings: listings.length,
    totalUnique: groups.length,
    filteredUnique: filtered.length,
    duplicateGroups,
    duplicateListings,
    page: safePage,
    pageSize,
    totalPages,
  });
});
