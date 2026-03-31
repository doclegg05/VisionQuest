import type { JobSourceAdapter, NormalizedJob } from "../types";
import { parseSalaryToHourly } from "../salary-parser";
import { logger } from "@/lib/logger";

/**
 * Adzuna adapter — aggregated job listings API.
 * Requires: ADZUNA_APP_ID and ADZUNA_APP_KEY
 */

const ADZUNA_BASE = "https://api.adzuna.com/v1/api/jobs/us/search/1";

interface AdzunaResult {
  id: string;
  title: string;
  company: { display_name: string };
  location: { display_name: string };
  salary_min: number | null;
  salary_max: number | null;
  description: string;
  redirect_url: string;
}

export const adzunaAdapter: JobSourceAdapter = {
  source: "adzuna",
  sourceType: "api",

  isConfigured(): boolean {
    return !!process.env.ADZUNA_APP_ID && !!process.env.ADZUNA_APP_KEY;
  },

  async fetchJobs(region: string, radiusMiles: number): Promise<NormalizedJob[]> {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;
    if (!appId || !appKey) return [];

    try {
      const params = new URLSearchParams({
        app_id: appId,
        app_key: appKey,
        where: region,
        distance: String(radiusMiles),
        results_per_page: "50",
        content_type: "application/json",
      });

      const res = await fetch(`${ADZUNA_BASE}?${params}`);

      if (!res.ok) {
        logger.error("Adzuna API error", { status: res.status });
        return [];
      }

      const json = await res.json();
      const results: AdzunaResult[] = json.results ?? [];

      return results.map((r) => {
        const salaryText =
          r.salary_min != null
            ? r.salary_max && r.salary_max !== r.salary_min
              ? `$${r.salary_min}-$${r.salary_max}/year`
              : `$${r.salary_min}/year`
            : null;

        return {
          title: r.title,
          company: r.company?.display_name ?? "Unknown",
          location: r.location?.display_name ?? "",
          salary: salaryText,
          salaryMin: parseSalaryToHourly(salaryText),
          description: r.description?.slice(0, 5000) ?? "",
          url: r.redirect_url,
          source: "adzuna",
          sourceType: "api" as const,
          sourceId: `adzuna:${r.id}`,
        };
      });
    } catch (err) {
      logger.error("Adzuna adapter error", { error: String(err) });
      return [];
    }
  },
};
