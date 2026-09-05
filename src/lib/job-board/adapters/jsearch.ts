import type { JobSourceAdapter, NormalizedJob } from "../types";
import { parseSalaryToHourly } from "../salary-parser";
import { inferJobWorkMode } from "../work-mode";
import { fetchJson, mapEachJob } from "./shared";

/**
 * JSearch adapter — uses RapidAPI's JSearch endpoint.
 * Requires: JSEARCH_API_KEY (RapidAPI key)
 */

const JSEARCH_HOST = "jsearch.p.rapidapi.com";

interface JSearchResult {
  job_id: string;
  job_title: string;
  employer_name: string;
  job_city: string;
  job_state: string;
  job_min_salary: number | null;
  job_max_salary: number | null;
  job_salary_currency: string | null;
  job_salary_period: string | null;
  job_description: string;
  job_apply_link: string;
}

interface JSearchApiResponse {
  data?: JSearchResult[];
}

export const jsearchAdapter: JobSourceAdapter = {
  source: "jsearch",
  sourceType: "api",

  isConfigured(): boolean {
    return !!process.env.JSEARCH_API_KEY;
  },

  async fetchJobs(region: string, radiusMiles: number): Promise<NormalizedJob[]> {
    const apiKey = process.env.JSEARCH_API_KEY;
    if (!apiKey) return [];

    const params = new URLSearchParams({
      query: `jobs in ${region}`,
      num_pages: "2",
      radius: String(radiusMiles),
    });

    // fetchJson (VQ-R-019) applies a 30s AbortSignal.timeout so a stalled
    // JSearch response cannot hang the whole refresh sweep.
    const json = await fetchJson<JSearchApiResponse>(`https://${JSEARCH_HOST}/search?${params}`, {
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": JSEARCH_HOST,
      },
    });
    const results: JSearchResult[] = json?.data ?? [];

    // mapEachJob isolates one malformed row (e.g. an unexpectedly-shaped
    // item that throws while reading a field) from the rest of the batch —
    // see its doc comment in ./shared for why that beats both the old
    // swallow-everything try/catch and a plain .map().
    return mapEachJob(results, "jsearch", (r) => {
      const salaryText = formatJSearchSalary(r);
      return {
        title: r.job_title,
        company: r.employer_name,
        location: [r.job_city, r.job_state].filter(Boolean).join(", "),
        workMode: inferJobWorkMode({
          source: "jsearch",
          title: r.job_title,
          company: r.employer_name,
          location: [r.job_city, r.job_state].filter(Boolean).join(", "),
          description: r.job_description,
        }),
        salary: salaryText,
        salaryMin: parseSalaryToHourly(salaryText),
        description: r.job_description?.slice(0, 5000) ?? "",
        url: r.job_apply_link,
        source: "jsearch",
        sourceType: "api" as const,
        sourceId: `jsearch:${r.job_id}`,
      };
    });
  },
};

function formatJSearchSalary(r: JSearchResult): string | null {
  if (!r.job_min_salary) return null;
  const period = r.job_salary_period?.toLowerCase() ?? "year";
  const currency = r.job_salary_currency === "USD" ? "$" : "";
  if (r.job_max_salary && r.job_max_salary !== r.job_min_salary) {
    return `${currency}${r.job_min_salary}-${currency}${r.job_max_salary}/${period}`;
  }
  return `${currency}${r.job_min_salary}/${period}`;
}
