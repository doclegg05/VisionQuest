import type { JobSourceAdapter, NormalizedJob } from "../types";
import { inferJobWorkMode } from "../work-mode";
import { fetchJson, stripHtml, textMatchesQuery, truncateDescription } from "./shared";

interface ArbeitnowResponse {
  data?: ArbeitnowJob[];
}

interface ArbeitnowJob {
  slug?: string;
  title?: string;
  company_name?: string;
  location?: string;
  description?: string;
  url?: string;
  remote?: boolean;
  tags?: string[];
  created_at?: number;
}

export const arbeitnowAdapter: JobSourceAdapter = {
  source: "arbeitnow",
  sourceType: "api",

  isConfigured(): boolean {
    return true;
  },

  async fetchJobs(region: string): Promise<NormalizedJob[]> {
    const data = await fetchJson<ArbeitnowResponse>("https://www.arbeitnow.com/api/job-board-api");
    const jobs = data?.data ?? [];
    const normalized: NormalizedJob[] = [];

    for (const job of jobs) {
      if (!job.slug || !job.title || !job.url) continue;
      if (!job.remote && !textMatchesQuery(region, job.location, job.title, job.tags?.join(" "))) {
        continue;
      }

      normalized.push({
        title: job.title,
        company: job.company_name || "Unknown",
        location: job.location || (job.remote ? "Remote" : ""),
        workMode: inferJobWorkMode({
          source: "arbeitnow",
          title: job.title,
          company: job.company_name,
          location: job.location,
          description: job.description,
          remote: job.remote,
        }),
        salary: null,
        salaryMin: null,
        description: truncateDescription(stripHtml(job.description)),
        url: job.url,
        source: "arbeitnow",
        sourceType: "api",
        sourceId: `arbeitnow:${job.slug}`,
        postedAt: (() => {
          if (job.created_at == null) return undefined;
          const d = new Date(job.created_at * 1000);
          return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
        })(),
      });

      if (normalized.length >= 60) break;
    }

    return normalized;
  },
};
