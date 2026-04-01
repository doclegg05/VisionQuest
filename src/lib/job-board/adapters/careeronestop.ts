import { logger } from "@/lib/logger";

import type { JobFetchResult, JobSourceAdapter, NormalizedJob } from "../types";

const CAREERONESTOP_BASE = "https://api.careeronestop.org";

interface CareerOneStopJob {
  JvId: string;
  JobTitle: string;
  Company: string;
  DescriptionSnippet: string;
  AcquisitionDate: string;
  URL: string;
  Location: string;
}

interface CareerOneStopJobsResponse {
  ErrorMessage?: string;
  Jobs?: CareerOneStopJob[];
}

function buildCareerOneStopPath(userId: string, region: string, radiusMiles: number) {
  const safeSegments = [
    "v2",
    "jobsearch",
    userId,
    "0",
    region,
    String(radiusMiles),
    "0",
    "0",
    "0",
    "50",
    "30",
  ].map((segment) => encodeURIComponent(segment));

  return `/${safeSegments.join("/")}`;
}

export const careerOneStopAdapter: JobSourceAdapter = {
  source: "careeronestop",
  sourceType: "api",

  isConfigured(): boolean {
    return !!process.env.CAREERONESTOP_API_TOKEN && !!process.env.CAREERONESTOP_USER_ID;
  },

  async fetchJobs(region: string, radiusMiles: number): Promise<JobFetchResult> {
    const apiToken = process.env.CAREERONESTOP_API_TOKEN;
    const userId = process.env.CAREERONESTOP_USER_ID;
    if (!apiToken || !userId) return { jobs: [] };

    try {
      const url = new URL(buildCareerOneStopPath(userId, region, radiusMiles), CAREERONESTOP_BASE);
      url.searchParams.set("enableJobDescriptionSnippet", "true");

      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
      });

      if (!res.ok) {
        logger.error("CareerOneStop API error", { status: res.status });
        return { jobs: [] };
      }

      const json = (await res.json()) as CareerOneStopJobsResponse;
      if (json.ErrorMessage) {
        logger.warn("CareerOneStop API returned an application error", { error: json.ErrorMessage });
      }

      const jobs: NormalizedJob[] = (json.Jobs ?? []).map((job) => ({
        title: job.JobTitle,
        company: job.Company || "CareerOneStop",
        location: job.Location ?? region,
        salary: null,
        salaryMin: null,
        description: job.DescriptionSnippet?.slice(0, 5000) ?? "",
        url: job.URL,
        source: "careeronestop",
        sourceType: "api",
        sourceId: `careeronestop:${job.JvId}`,
      }));

      return { jobs };
    } catch (error) {
      logger.error("CareerOneStop adapter error", { error: String(error) });
      return { jobs: [] };
    }
  },
};
