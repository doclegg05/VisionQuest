import type { JobSourceAdapter, NormalizedJob } from "../types";
import { inferJobWorkMode } from "../work-mode";
import { fetchJson, stripHtml, truncateDescription } from "./shared";
import { getSpokesJobQueryTitles } from "../spokes-job-queries";

/**
 * CareerOneStop "List Jobs" adapter — surfaces National Labor Exchange (NLx)
 * postings, which aggregate state job-bank listings (incl. WorkForce WV).
 * Requires COS_USER_ID and COS_API_TOKEN (free, royalty-free registration).
 * Returns [] when unconfigured.
 */
const COS_BASE = "https://api.careeronestop.org/v1/jobsearch";
const MAX_RESULTS = 60;
const PAGE_SIZE = 20;
const RECENCY_DAYS = 30;
const DEFAULT_RADIUS = 25;

interface CareerOneStopJob {
  JvId?: string;
  JobTitle?: string;
  Company?: string;
  Location?: string;
  URL?: string;
  Description?: string;
  DatePosted?: string;
}

interface CareerOneStopResponse {
  Jobs?: CareerOneStopJob[];
}

export const careerOneStopAdapter: JobSourceAdapter = {
  source: "careeronestop",
  sourceType: "api",

  isConfigured(): boolean {
    return Boolean(process.env.COS_USER_ID && process.env.COS_API_TOKEN);
  },

  async fetchJobs(region: string, radiusMiles: number): Promise<NormalizedJob[]> {
    const userId = process.env.COS_USER_ID;
    const token = process.env.COS_API_TOKEN;
    if (!userId || !token) return [];

    const location = region.trim() || "US";
    const radius = radiusMiles > 0 ? radiusMiles : DEFAULT_RADIUS;
    const seen = new Set<string>();
    const out: NormalizedJob[] = [];

    for (const keyword of getSpokesJobQueryTitles()) {
      if (out.length >= MAX_RESULTS) break;

      const path = [
        encodeURIComponent(userId),
        encodeURIComponent(keyword),
        encodeURIComponent(location),
        String(radius),
        "0", // sortColumns (relevance)
        "0", // sortOrder
        "0", // startRecord
        String(PAGE_SIZE),
        String(RECENCY_DAYS),
      ].join("/");

      const data = await fetchJson<CareerOneStopResponse>(
        `${COS_BASE}/${path}?source=NLx&showFilters=false`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      for (const job of data?.Jobs ?? []) {
        if (!job.JvId || !job.JobTitle || !job.URL) continue;
        const sourceId = `careeronestop:${job.JvId}`;
        if (seen.has(sourceId)) continue;
        seen.add(sourceId);

        const jobLocation = job.Location?.trim() || region;
        out.push({
          title: job.JobTitle,
          company: job.Company?.trim() || "Unknown",
          location: jobLocation,
          workMode: inferJobWorkMode({
            source: "careeronestop",
            title: job.JobTitle,
            company: job.Company,
            location: jobLocation,
            description: job.Description,
          }),
          salary: null,
          salaryMin: null,
          description: truncateDescription(stripHtml(job.Description)),
          url: job.URL,
          source: "careeronestop",
          sourceType: "api",
          sourceId,
        });

        if (out.length >= MAX_RESULTS) break;
      }
    }

    return out;
  },
};
