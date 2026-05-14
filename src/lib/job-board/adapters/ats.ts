import { parseSalaryToHourly } from "../salary-parser";
import type { JobSourceAdapter, NormalizedJob } from "../types";
import { inferJobWorkMode } from "../work-mode";
import { fetchJson, stripHtml, textMatchesQuery, truncateDescription } from "./shared";

const DEFAULT_GREENHOUSE = [
  "airbnb",
  "anthropic",
  "coinbase",
  "datadog",
  "discord",
  "dropbox",
  "duolingo",
  "figma",
  "gitlab",
  "mongodb",
  "reddit",
  "stripe",
  "cloudflare",
  "elastic",
  "okta",
  "twilio",
] as const;

const DEFAULT_LEVER = ["wealthfront"] as const;

const DEFAULT_ASHBY = [
  "browserbase",
  "clerk",
  "linear",
  "modal",
  "openai",
  "posthog",
  "ramp",
  "supabase",
  "writer",
] as const;

function isRemote(location: string): boolean {
  return location.toLowerCase().includes("remote");
}

function keepForClassRegion(region: string, location: string): boolean {
  return !region.trim() || isRemote(location) || textMatchesQuery(region, location);
}

interface GreenhouseJob {
  id?: number | string;
  title?: string;
  absolute_url?: string;
  content?: string;
  updated_at?: string;
  location?: { name?: string };
  offices?: Array<{ name?: string }>;
}

interface GreenhouseResponse {
  jobs?: GreenhouseJob[];
}

export const greenhouseAdapter: JobSourceAdapter = {
  source: "greenhouse",
  sourceType: "api",

  isConfigured(): boolean {
    return true;
  },

  async fetchJobs(region: string): Promise<NormalizedJob[]> {
    const out: NormalizedJob[] = [];

    for (const board of DEFAULT_GREENHOUSE) {
      const data = await fetchJson<GreenhouseResponse>(
        `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
      );
      for (const job of data?.jobs ?? []) {
        const offices = (job.offices ?? []).map((office) => office.name).filter(Boolean).join(", ");
        const location = offices || job.location?.name || "";
        if (!job.id || !job.title || !job.absolute_url || !keepForClassRegion(region, location)) continue;

        out.push({
          title: job.title,
          company: board,
          location,
          workMode: inferJobWorkMode({
            source: "greenhouse",
            title: job.title,
            company: board,
            location,
            description: job.content,
          }),
          salary: null,
          salaryMin: null,
          description: truncateDescription(stripHtml(job.content)),
          url: job.absolute_url,
          source: "greenhouse",
          sourceType: "api",
          sourceId: `greenhouse:${board}:${job.id}`,
        });
        if (out.length >= 60) return out;
      }
    }

    return out;
  },
};

interface LeverJob {
  id?: string;
  text?: string;
  hostedUrl?: string;
  description?: string;
  descriptionPlain?: string;
  categories?: { location?: string };
}

export const leverAdapter: JobSourceAdapter = {
  source: "lever",
  sourceType: "api",

  isConfigured(): boolean {
    return true;
  },

  async fetchJobs(region: string): Promise<NormalizedJob[]> {
    const out: NormalizedJob[] = [];

    for (const board of DEFAULT_LEVER) {
      const data = await fetchJson<LeverJob[]>(`https://api.lever.co/v0/postings/${board}?mode=json`);
      for (const job of Array.isArray(data) ? data : []) {
        const location = job.categories?.location || "";
        if (!job.id || !job.text || !job.hostedUrl || !keepForClassRegion(region, location)) continue;

        out.push({
          title: job.text,
          company: board,
          location,
          workMode: inferJobWorkMode({
            source: "lever",
            title: job.text,
            company: board,
            location,
            description: job.descriptionPlain || job.description,
          }),
          salary: null,
          salaryMin: null,
          description: truncateDescription(stripHtml(job.descriptionPlain || job.description)),
          url: job.hostedUrl,
          source: "lever",
          sourceType: "api",
          sourceId: `lever:${board}:${job.id}`,
        });
        if (out.length >= 60) return out;
      }
    }

    return out;
  },
};

interface AshbyJob {
  id?: string;
  title?: string;
  jobUrl?: string;
  descriptionPlain?: string;
  location?: string;
  isRemote?: boolean;
  compensation?: {
    compensationTierSummary?: string;
  };
}

interface AshbyResponse {
  jobs?: AshbyJob[];
}

export const ashbyAdapter: JobSourceAdapter = {
  source: "ashby",
  sourceType: "api",

  isConfigured(): boolean {
    return true;
  },

  async fetchJobs(region: string): Promise<NormalizedJob[]> {
    const out: NormalizedJob[] = [];

    for (const board of DEFAULT_ASHBY) {
      const data = await fetchJson<AshbyResponse>(
        `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`,
      );
      for (const job of data?.jobs ?? []) {
        const location = job.location || (job.isRemote ? "Remote" : "");
        if (!job.id || !job.title || !job.jobUrl || !keepForClassRegion(region, location)) continue;

        const salary = job.compensation?.compensationTierSummary || null;
        out.push({
          title: job.title,
          company: board,
          location,
          workMode: inferJobWorkMode({
            source: "ashby",
            title: job.title,
            company: board,
            location,
            description: job.descriptionPlain,
            remote: job.isRemote,
          }),
          salary,
          salaryMin: parseSalaryToHourly(salary),
          description: truncateDescription(stripHtml(job.descriptionPlain)),
          url: job.jobUrl,
          source: "ashby",
          sourceType: "api",
          sourceId: `ashby:${board}:${job.id}`,
        });
        if (out.length >= 60) return out;
      }
    }

    return out;
  },
};
