import type { EmploymentType } from "./employment-type";

export interface JobFilterValues {
  q: string;
  postedWithinDays: number | null;
  minPay: number | null;
  jobType: EmploymentType | null;
}

const ALLOWED_DAYS = new Set([7, 14, 30]);
const DAY_MS = 86_400_000;

export function parseJobFilters(searchParams: URLSearchParams): JobFilterValues {
  const q = (searchParams.get("q") ?? "").trim().slice(0, 100);

  const daysNum = Number(searchParams.get("postedWithinDays"));
  const postedWithinDays = ALLOWED_DAYS.has(daysNum) ? daysNum : null;

  const payNum = Number(searchParams.get("minPay"));
  const minPay = Number.isFinite(payNum) && payNum > 0 ? payNum : null;

  const jobTypeRaw = searchParams.get("jobType");
  const jobType = jobTypeRaw === "full_time" || jobTypeRaw === "part_time" ? jobTypeRaw : null;

  return { q, postedWithinDays, minPay, jobType };
}

/**
 * Extra Prisma `where` clauses for JobListing. minPay deliberately keeps
 * unknown-pay jobs (salaryMin null) so missing data never hides a job.
 *
 * @param dateField - The date field to filter on for postedWithinDays. Defaults
 *   to "createdAt" (JobListing behaviour). Pass "postedAt" for JobBrowseListing.
 */
export function buildJobFilterWhere(
  filters: JobFilterValues,
  now: Date,
  dateField: "createdAt" | "postedAt" = "createdAt",
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const and: unknown[] = [];

  if (filters.q) {
    and.push({
      OR: [
        { title: { contains: filters.q, mode: "insensitive" } },
        { company: { contains: filters.q, mode: "insensitive" } },
        { description: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }

  if (filters.minPay != null) {
    and.push({ OR: [{ salaryMin: { gte: filters.minPay } }, { salaryMin: null }] });
  }

  if (filters.postedWithinDays != null) {
    where[dateField] = { gte: new Date(now.getTime() - filters.postedWithinDays * DAY_MS) };
  }

  if (filters.jobType != null) {
    where.employmentType = filters.jobType;
  }

  if (and.length > 0) where.AND = and;

  return where;
}
