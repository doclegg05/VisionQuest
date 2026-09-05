import type { JobSourceAdapter, NormalizedJob } from "../types";
import { parseSalaryToHourly } from "../salary-parser";
import { inferJobWorkMode } from "../work-mode";
import { fetchJson, mapEachJob } from "./shared";

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

interface AdzunaApiResponse {
  results?: AdzunaResult[];
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

    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      where: region,
      distance: String(radiusMiles),
      results_per_page: "50",
      content_type: "application/json",
    });
    const url = `${ADZUNA_BASE}?${params}`;

    // fetchJson (VQ-R-019) applies a 30s AbortSignal.timeout so a stalled
    // Adzuna response cannot hang the whole refresh sweep. Unlike the other
    // adapters, ADZUNA_APP_ID/ADZUNA_APP_KEY ride in the query string rather
    // than a header, so redact them from the URL a failure would otherwise
    // log verbatim (mirrors the CareerOneStop logUrl convention).
    const logParams = new URLSearchParams(params);
    logParams.set("app_id", "[redacted]");
    logParams.set("app_key", "[redacted]");
    const json = await fetchJson<AdzunaApiResponse>(url, {}, { logUrl: `${ADZUNA_BASE}?${logParams}` });
    const results: AdzunaResult[] = json?.results ?? [];

    // mapEachJob isolates one malformed row from the rest of the batch —
    // see its doc comment in ./shared.
    return mapEachJob(results, "adzuna", (r) => {
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
        workMode: inferJobWorkMode({
          source: "adzuna",
          title: r.title,
          company: r.company?.display_name,
          location: r.location?.display_name,
          description: r.description,
        }),
        salary: salaryText,
        salaryMin: parseSalaryToHourly(salaryText),
        description: r.description?.slice(0, 5000) ?? "",
        url: r.redirect_url,
        source: "adzuna",
        sourceType: "api" as const,
        sourceId: `adzuna:${r.id}`,
      };
    });
  },
};
