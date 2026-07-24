import type { JobSourceAdapter, NormalizedJob } from "../types";
import { inferJobWorkMode } from "../work-mode";
import { inferEmploymentType } from "../employment-type";
import { hourlyFromAmount } from "../salary-parser";
import { stripHtml, truncateDescription } from "./shared";
import { getSpokesJobQueryTitles } from "../spokes-job-queries";
import { logger } from "@/lib/logger";

/**
 * Indeed adapter, backed by the `kaix/indeed-scraper` Apify Actor.
 *
 * Indeed has no public API but carries the bulk of WV hourly/entry-level
 * postings — the gap the CareerOneStop/NLx feed leaves. Requires APIFY_TOKEN.
 * Returns [] when unconfigured.
 *
 * Sizing comes from the 2026-07-24 pilot (see
 * docs/superpowers/plans/2026-07-24-apify-job-sources.md): a full statewide
 * week is ~158 postings, so the per-query cap is generous and the real spend
 * is a fraction of a cent per run.
 */

const ACTOR_ID = "kaix~indeed-scraper";
const RUN_ENDPOINT = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items`;

/** Titles per `title:(... or ...)` query. 13 SPOKES titles → 2 queries. */
const TITLES_PER_QUERY = 7;
const MAX_ITEMS_PER_QUERY = 200;
const RECENCY_DAYS = "7";
const DEFAULT_RADIUS = 25;

/**
 * run-sync-get-dataset-items hard-fails at 300s with a 408. Pilot runs took
 * ~82s each, so queries are issued in parallel and the actor run is capped
 * well inside the API ceiling.
 */
const RUN_TIMEOUT_SECS = 180;
const REQUEST_TIMEOUT_MS = 240_000;

/** Spend ceiling per query. Pilot cost for a full statewide run was ~$0.008. */
const MAX_CHARGE_USD = 0.25;

/** Radius values the actor's input schema accepts. */
const ALLOWED_RADII = [0, 5, 10, 15, 25, 35, 50, 100];

interface IndeedSalary {
  text?: string | null;
  min?: number | null;
  max?: number | null;
  exact?: number | null;
  period?: string | null;
}

interface IndeedRow {
  id?: string | null;
  title?: { text?: string | null } | null;
  company?: { name?: string | null } | null;
  location?: { formatted?: string | null } | null;
  description?: { text?: string | null } | null;
  urls?: { indeed?: string | null; external?: string | null; apply?: string | null } | null;
  dates?: { posted?: string | null } | null;
  salary?: IndeedSalary | null;
  workArrangement?: { isRemote?: boolean | null } | null;
  signals?: { isExpired?: boolean | null } | null;
}

/**
 * Normalizes Indeed's structured salary to an hourly rate.
 *
 * Uses the structured `period` field rather than parsing `salary.text`: the
 * period is stated unambiguously here, so there is nothing to infer. Prefers
 * `min` (the conservative floor of a range), then `exact` — how Indeed encodes
 * a single value like "$18 an hour" — then `max`. Conversion and the
 * plausibility guard are shared with the text parser via hourlyFromAmount.
 */
export function hourlyFromIndeedSalary(salary: IndeedSalary | null | undefined): number | null {
  return hourlyFromAmount(salary?.min ?? salary?.exact ?? salary?.max, salary?.period);
}

/**
 * Groups SPOKES titles into Indeed advanced-syntax queries. One query per
 * title would mean 13 actor runs per region; grouping makes it 2 with the
 * same coverage.
 */
export function buildIndeedTitleQueries(titles: string[]): string[] {
  const cleaned = titles
    .map((title) => title.replace(/"/g, "").trim())
    .filter((title) => title.length > 0);

  const queries: string[] = [];
  for (let i = 0; i < cleaned.length; i += TITLES_PER_QUERY) {
    const group = cleaned.slice(i, i + TITLES_PER_QUERY);
    queries.push(`title:(${group.map((title) => `"${title}"`).join(" or ")})`);
  }
  return queries;
}

function snapRadius(radiusMiles: number): string {
  const target = radiusMiles > 0 ? radiusMiles : DEFAULT_RADIUS;
  const nearest = ALLOWED_RADII.reduce((best, value) =>
    Math.abs(value - target) < Math.abs(best - target) ? value : best,
  );
  return String(nearest);
}

/**
 * Runs one grouped query. The token travels in the Authorization header, never
 * the URL, so a failure log cannot leak it.
 */
async function runQuery(
  token: string,
  keyword: string,
  location: string,
  radius: string,
): Promise<IndeedRow[]> {
  const params = new URLSearchParams({
    timeout: String(RUN_TIMEOUT_SECS),
    maxTotalChargeUsd: String(MAX_CHARGE_USD),
    format: "json",
    clean: "true",
  });
  const url = `${RUN_ENDPOINT}?${params}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        keyword,
        location,
        country: "US",
        radius,
        radiusUnit: "miles",
        fromDays: RECENCY_DAYS,
        sort: "date",
        maxItems: MAX_ITEMS_PER_QUERY,
        searchMode: "basic",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn("Apify Indeed run failed", { status: response.status, location });
      return [];
    }

    const items = (await response.json()) as unknown;
    return Array.isArray(items) ? (items as IndeedRow[]) : [];
  } catch (error) {
    logger.warn("Apify Indeed run errored", { location, error: String(error) });
    return [];
  }
}

function toNormalizedJob(row: IndeedRow, region: string): NormalizedJob | null {
  const id = row.id?.trim();
  const title = row.title?.text?.trim();
  const url = row.urls?.indeed ?? row.urls?.external ?? row.urls?.apply ?? null;

  if (!id || !title || !url) return null;
  if (row.signals?.isExpired) return null;

  const location = row.location?.formatted?.trim() || region;
  const description = truncateDescription(stripHtml(row.description?.text));

  return {
    title,
    company: row.company?.name?.trim() || "Unknown",
    location,
    workMode: inferJobWorkMode({
      source: "apify-indeed",
      title,
      company: row.company?.name,
      location,
      description,
      remote: row.workArrangement?.isRemote ?? false,
    }),
    salary: row.salary?.text?.trim() || null,
    salaryMin: hourlyFromIndeedSalary(row.salary),
    employmentType: inferEmploymentType({ title, description }),
    description,
    url,
    source: "apify-indeed",
    sourceType: "scrape",
    sourceId: `apify-indeed:${id}`,
    postedAt: row.dates?.posted ?? null,
  };
}

export const apifyIndeedAdapter: JobSourceAdapter = {
  source: "apify-indeed",
  sourceType: "scrape",

  isConfigured(): boolean {
    return !!process.env.APIFY_TOKEN;
  },

  async fetchJobs(region: string, radiusMiles: number): Promise<NormalizedJob[]> {
    const token = process.env.APIFY_TOKEN;
    if (!token) return [];

    const location = region.trim() || "US";
    const radius = snapRadius(radiusMiles);
    const queries = buildIndeedTitleQueries(getSpokesJobQueryTitles());

    // Issued in parallel so total wall-clock stays near a single run (~85s)
    // rather than the sum. runQuery resolves to [] on failure, so one bad
    // query cannot discard the others' results.
    const batches = await Promise.all(
      queries.map((keyword) => runQuery(token, keyword, location, radius)),
    );

    const seen = new Set<string>();
    const out: NormalizedJob[] = [];

    for (const rows of batches) {
      for (const row of rows) {
        const job = toNormalizedJob(row, region);
        if (!job || seen.has(job.sourceId)) continue;
        seen.add(job.sourceId);
        out.push(job);
      }
    }

    return out;
  },
};
