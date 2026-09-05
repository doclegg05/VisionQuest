import type { JobSourceAdapter, NormalizedJob } from "../types";
import { inferJobWorkMode } from "../work-mode";
import { fetchJson, stripHtml, truncateDescription } from "./shared";
import { getSpokesJobQueryTitles } from "../spokes-job-queries";
import { parseSalaryToHourly } from "../salary-parser";

/**
 * Talroo Search API adapter (publisher program) — surfaces the hourly,
 * blue-collar postings Talroo aggregates from employer feeds, a good fit for
 * SPOKES's entry-level pool. Requires TALROO_API_KEY. Returns [] when
 * unconfigured.
 *
 * ASSUMED SHAPE, UNVERIFIED (2026-09-05): no TALROO_API_KEY has been issued
 * yet (see docs/plans/2026-09-04-nlx-macc-job-search-research.md Part 2,
 * owner step P0.2 in docs/superpowers/plans/2026-09-05-match-and-connect.md),
 * so the request/response shapes below have never been exercised against the
 * live API. They are this adapter's best-guess reading of Talroo's publisher
 * program description:
 *
 *   GET https://api.talroo.com/v1/search
 *     ?q=<keyword>&l=<location>&radius=<km>&page_size=<n>
 *     Header: Authorization: Bearer <TALROO_API_KEY>
 *   Response: { jobs: TalrooJob[] }, each job carrying id, title, company,
 *     city, state, description, url (see the tracking-URL note below),
 *     posted_at, and an optional salary_details {min, max, period}.
 *
 * `scripts/talroo-smoke.mjs` is the first thing to run once a real
 * TALROO_API_KEY lands (`npm run talroo:smoke`) — it exercises fetchJobs()
 * against the live API and reports whether requests actually succeed. All
 * field mapping is isolated in mapTalrooJob() below so that if the real shape
 * differs, there is exactly one function to fix and this comment to correct.
 */

const TALROO_BASE = "https://api.talroo.com/v1/search";
const MAX_RESULTS = 60;
const PAGE_SIZE = 20;
const DEFAULT_RADIUS_MILES = 25;
const MILES_TO_KM = 1.60934;

interface TalrooSalaryDetails {
  min?: number | null;
  max?: number | null;
  period?: string | null;
}

interface TalrooJob {
  id?: string;
  title?: string;
  company?: string;
  city?: string;
  state?: string;
  description?: string;
  /**
   * Talroo's publisher terms require clicks to route through their tracking
   * URL — this MUST be kept verbatim as NormalizedJob.url, never rewritten,
   * shortened, or stripped of query params.
   */
  url?: string;
  posted_at?: string | null;
  salary_details?: TalrooSalaryDetails | null;
}

interface TalrooResponse {
  jobs?: TalrooJob[];
}

/** Renders Talroo's structured {min, max, period} into text parseSalaryToHourly understands. */
function talrooSalaryText(details: TalrooSalaryDetails | null | undefined): string | null {
  if (!details) return null;
  const { min, max, period } = details;
  if (min == null && max == null) return null;
  const low = min ?? max;
  const high = max ?? min;
  const suffix = period ? `/${period}` : "";
  if (low !== high) return `$${low}-$${high}${suffix}`;
  return `$${low}${suffix}`;
}

/**
 * Maps one Talroo job to NormalizedJob, or null when a required field is
 * missing. The one place this adapter's shape assumptions live — see the
 * header comment above.
 */
export function mapTalrooJob(job: TalrooJob, fallbackLocation: string): NormalizedJob | null {
  if (!job.id || !job.title || !job.url) return null;

  const location = [job.city, job.state].filter(Boolean).join(", ") || fallbackLocation;
  const salaryText = talrooSalaryText(job.salary_details);

  return {
    title: job.title,
    company: job.company?.trim() || "Unknown",
    location,
    workMode: inferJobWorkMode({
      source: "talroo",
      title: job.title,
      company: job.company,
      location,
      description: job.description,
    }),
    salary: salaryText,
    salaryMin: parseSalaryToHourly(salaryText),
    description: truncateDescription(stripHtml(job.description)),
    url: job.url,
    source: "talroo",
    sourceType: "api",
    sourceId: `talroo:${job.id}`,
    // Talroo aggregates from many employer feeds that each repost the same
    // opening on their own cadence, so posted_at can repeat or jump backward
    // across scrapes — treat it as approximate, not authoritative recency.
    postedAt: job.posted_at ?? null,
  };
}

export const talrooAdapter: JobSourceAdapter = {
  source: "talroo",
  sourceType: "api",

  isConfigured(): boolean {
    return !!process.env.TALROO_API_KEY;
  },

  async fetchJobs(region: string, radiusMiles: number): Promise<NormalizedJob[]> {
    const apiKey = process.env.TALROO_API_KEY;
    if (!apiKey) return [];

    const location = region.trim() || "US";
    const milesUsed = radiusMiles > 0 ? radiusMiles : DEFAULT_RADIUS_MILES;
    const radiusKm = String(Math.round(milesUsed * MILES_TO_KM));
    const seen = new Set<string>();
    const out: NormalizedJob[] = [];

    for (const keyword of getSpokesJobQueryTitles()) {
      if (out.length >= MAX_RESULTS) break;

      const params = new URLSearchParams({
        q: keyword,
        l: location,
        radius: radiusKm,
        page_size: String(PAGE_SIZE),
      });
      const url = `${TALROO_BASE}?${params}`;

      const data = await fetchJson<TalrooResponse>(
        url,
        { headers: { Authorization: `Bearer ${apiKey}` } },
        // The key lives only in the Authorization header (never the URL),
        // but redact defensively in case that ever changes.
        { logUrl: url.split(apiKey).join("[talroo-key]") },
      );

      for (const job of data?.jobs ?? []) {
        const normalized = mapTalrooJob(job, region);
        if (!normalized) continue;
        if (seen.has(normalized.sourceId)) continue;
        seen.add(normalized.sourceId);
        out.push(normalized);
        if (out.length >= MAX_RESULTS) break;
      }
    }

    return out;
  },
};
