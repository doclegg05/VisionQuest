import type { JobSourceAdapter, NormalizedJob } from "../types";
import { inferJobWorkMode } from "../work-mode";
import { fetchJson, stripHtml, truncateDescription } from "./shared";
import { getSpokesJobQueryTitles } from "../spokes-job-queries";
import { WORKFORCE_WV_COMPANY_LABEL } from "../wv-employer";
import {
  COS_API_BASE,
  careerOneStopCredentials,
  isCareerOneStopConfigured,
} from "@/lib/career/careeronestop-config";

/**
 * CareerOneStop "List Jobs" adapter — surfaces National Labor Exchange (NLx)
 * postings, which aggregate state job-bank listings (incl. WorkForce WV).
 * Requires COS_USER_ID and COS_API_TOKEN (free, royalty-free registration —
 * shared with the counseling client via @/lib/career/careeronestop-config).
 * Returns [] when unconfigured.
 *
 * Two kinds of pass per region:
 *   1. The WorkForce WV pass — every posting in the region filtered to the
 *      NLx company label "West Virginia Employer" (the MACC's staff-entered
 *      jobs; see ../wv-employer.ts). Runs FIRST with its own cap so the
 *      title passes can never crowd it out: these are the postings the
 *      program most wants students applying to.
 *   2. One title pass per SPOKES query title, capped at MAX_RESULTS in total.
 */
const COS_BASE = `${COS_API_BASE}/v1/jobsearch`;
const MAX_RESULTS = 60;
const PAGE_SIZE = 20;
const RECENCY_DAYS = 30;
const DEFAULT_RADIUS = 25;
/** CareerOneStop: keyword "0" = every posting within the city/ZIP/state. */
const ALL_JOBS_KEYWORD = "0";
const WORKFORCE_WV_PAGE_SIZE = 50;

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
    return isCareerOneStopConfigured();
  },

  async fetchJobs(region: string, radiusMiles: number): Promise<NormalizedJob[]> {
    const credentials = careerOneStopCredentials();
    if (!credentials) return [];
    const { userId, token } = credentials;

    const location = region.trim() || "US";
    const radius = radiusMiles > 0 ? radiusMiles : DEFAULT_RADIUS;
    const seen = new Set<string>();
    const out: NormalizedJob[] = [];

    const runPass = async (
      keyword: string,
      pageSize: number,
      companyName: string | null,
    ): Promise<CareerOneStopJob[]> => {
      const path = [
        encodeURIComponent(keyword),
        encodeURIComponent(location),
        String(radius),
        "0", // sortColumns (relevance)
        "0", // sortOrder
        "0", // startRecord
        String(pageSize),
        String(RECENCY_DAYS),
      ].join("/");
      const search =
        "?source=NLx&showFilters=false" +
        (companyName ? `&companyName=${encodeURIComponent(companyName)}` : "");

      const data = await fetchJson<CareerOneStopResponse>(
        `${COS_BASE}/${encodeURIComponent(userId)}/${path}${search}`,
        { headers: { Authorization: `Bearer ${token}` } },
        // Request paths embed COS_USER_ID, which must never be logged
        // (careeronestop-config.ts contract) — log a redacted URL instead,
        // mirroring careeronestop-counseling.ts's endpoint-label practice.
        { logUrl: `${COS_BASE}/[cos-user]/${path}${search}` },
      );
      return data?.Jobs ?? [];
    };

    const collect = (job: CareerOneStopJob): boolean => {
      if (!job.JvId || !job.JobTitle || !job.URL) return false;
      const sourceId = `careeronestop:${job.JvId}`;
      if (seen.has(sourceId)) return false;
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
      return true;
    };

    // Pass 1: WorkForce WV (MACC) postings, additive to the title cap below.
    for (const job of await runPass(ALL_JOBS_KEYWORD, WORKFORCE_WV_PAGE_SIZE, WORKFORCE_WV_COMPANY_LABEL)) {
      collect(job);
    }
    const titleBudget = out.length + MAX_RESULTS;

    // Pass 2: one query per SPOKES title.
    for (const keyword of getSpokesJobQueryTitles()) {
      if (out.length >= titleBudget) break;
      for (const job of await runPass(keyword, PAGE_SIZE, null)) {
        collect(job);
        if (out.length >= titleBudget) break;
      }
    }

    return out;
  },
};
