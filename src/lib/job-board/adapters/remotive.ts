import { parseSalaryToHourly } from "../salary-parser";
import type { JobSourceAdapter, NormalizedJob } from "../types";
import { fetchJson, stripHtml, truncateDescription } from "./shared";

interface RemotiveResponse {
  jobs?: RemotiveJob[];
}

interface RemotiveJob {
  id: number | string;
  title?: string;
  company_name?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
  url?: string;
}

export const remotiveAdapter: JobSourceAdapter = {
  source: "remotive",
  sourceType: "api",

  isConfigured(): boolean {
    return true;
  },

  async fetchJobs(): Promise<NormalizedJob[]> {
    const params = new URLSearchParams({ limit: "60" });
    const data = await fetchJson<RemotiveResponse>(`https://remotive.com/api/remote-jobs?${params}`);
    const jobs = data?.jobs ?? [];

    return jobs
      .filter((job) => job.id && job.title && job.url)
      .map((job) => {
        const salary = job.salary || null;
        return {
          title: job.title ?? "",
          company: job.company_name ?? "Unknown",
          location: job.candidate_required_location || "Remote",
          workMode: "remote" as const,
          salary,
          salaryMin: parseSalaryToHourly(salary),
          description: truncateDescription(stripHtml(job.description)),
          url: job.url ?? "",
          source: "remotive",
          sourceType: "api" as const,
          sourceId: `remotive:${job.id}`,
        };
      });
  },
};
