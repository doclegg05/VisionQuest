import { parseSalaryToHourly } from "../salary-parser";
import type { JobSourceAdapter, NormalizedJob } from "../types";
import { annualSalaryText, fetchJson, stripHtml, truncateDescription } from "./shared";

interface RemoteOkJob {
  id?: number | string;
  position?: string;
  company?: string;
  location?: string;
  description?: string;
  url?: string;
  apply_url?: string;
  salary_min?: number | null;
  salary_max?: number | null;
  tags?: string[];
  date?: string;
}

export const remoteOkAdapter: JobSourceAdapter = {
  source: "remoteok",
  sourceType: "api",

  isConfigured(): boolean {
    return true;
  },

  async fetchJobs(): Promise<NormalizedJob[]> {
    const data = await fetchJson<RemoteOkJob[]>("https://remoteok.com/api");
    const jobs = Array.isArray(data) ? data : [];
    const normalized: NormalizedJob[] = [];

    for (const job of jobs) {
      if (!job.id || !job.position) continue;

      const salary = annualSalaryText(job.salary_min, job.salary_max);
      normalized.push({
        title: job.position,
        company: job.company || "Unknown",
        location: job.location || "Remote",
        workMode: "remote" as const,
        salary,
        salaryMin: parseSalaryToHourly(salary),
        description: truncateDescription(stripHtml(job.description)),
        url: job.url || job.apply_url || `https://remoteok.com/remote-jobs/${job.id}`,
        source: "remoteok",
        sourceType: "api",
        sourceId: `remoteok:${job.id}`,
        postedAt: (() => {
          if (!job.date) return undefined;
          const d = new Date(job.date);
          return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
        })(),
      });

      if (normalized.length >= 60) break;
    }

    return normalized;
  },
};
