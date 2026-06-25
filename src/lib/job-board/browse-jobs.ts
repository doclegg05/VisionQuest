import { prisma } from "@/lib/db";
import { parseJobFilters, buildJobFilterWhere } from "./job-filters";

/**
 * Load active, non-expired listings from the program-wide browse pool.
 * Browse listings are always remote — the Local tab never includes them.
 */
export async function loadBrowseJobs(params: {
  proximity: "local" | "remote" | "all";
  sort: string;
  searchParams: URLSearchParams;
  limit?: number;
}) {
  // Local tab never includes the (remote) browse pool.
  if (params.proximity === "local") return [];

  const now = new Date();
  const where: Record<string, unknown> = {
    status: "active",
    expiresAt: { gt: now },
  };
  // Browse listings use postedAt for the "posted within" filter (not createdAt).
  Object.assign(where, buildJobFilterWhere(parseJobFilters(params.searchParams), now, "postedAt"));

  return prisma.jobBrowseListing.findMany({
    where,
    orderBy: params.sort === "salary" ? { salaryMin: "desc" } : { postedAt: "desc" },
    take: params.limit ?? 100,
  });
}
