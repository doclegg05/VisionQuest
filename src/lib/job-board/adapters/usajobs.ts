import type { JobSourceAdapter, NormalizedJob } from "../types";
import { hourlyFromAmount, type PayPeriod } from "../salary-parser";
import { inferJobWorkMode } from "../work-mode";
import { fetchJson, mapEachJob } from "./shared";

/**
 * USAJobs adapter — official federal government job listings API.
 * Requires: USAJOBS_API_KEY and USAJOBS_EMAIL
 */

/**
 * USAJobs' RateIntervalCode → the pay period it names, or null when the
 * code has no fixed-hours convention to convert through. Every code
 * besides "PA" used to fall through to "hr" unconditionally, so a
 * per-week, per-day, per-month, or bi-weekly range had its raw figure
 * parsed as an hourly wage — off by one to two orders of magnitude in the
 * min-pay filter and match scoring.
 *
 * FB (fee basis) has no fixed period at all. PY and SY (school year) cover
 * roughly 9-10 months of instructional time, not PERIOD_HOURS.yearly's
 * 2080-hour calendar-year convention — treating either as annual would
 * invent a rate rather than read one, so both resolve to null and the raw
 * range is still shown via `salary` (salaryRaw).
 */
const RATE_INTERVAL_PERIODS: Readonly<Record<string, PayPeriod | null>> = {
  PA: "yearly", // Per Annum
  PH: "hourly", // Per Hour
  PD: "daily", // Per Day
  PW: "weekly", // Per Week
  PM: "monthly", // Per Month
  BW: "biweekly", // Bi-Weekly
  FB: null, // Fee Basis
  PY: null, // Per Year (school year, ambiguous hours)
  SY: null, // School Year
};

/** Human-readable unit for the raw salary text, falling back to the code itself. */
const RATE_INTERVAL_LABELS: Readonly<Record<string, string>> = {
  PA: "year",
  PH: "hour",
  PD: "day",
  PW: "week",
  PM: "month",
  BW: "biweek",
  FB: "fee basis",
  PY: "school year",
  SY: "school year",
};

const USAJOBS_BASE = "https://data.usajobs.gov/api/search";

interface USAJobsPositionRemuneration {
  MinimumRange: string;
  MaximumRange: string;
  RateIntervalCode: string;
}

interface USAJobsDescriptor {
  PositionTitle: string;
  OrganizationName: string;
  PositionLocationDisplay: string;
  PositionRemuneration: USAJobsPositionRemuneration[];
  QualificationSummary: string;
  PositionURI: string;
}

interface USAJobsSearchItem {
  MatchedObjectId: string;
  MatchedObjectDescriptor: USAJobsDescriptor;
}

interface USAJobsApiResponse {
  SearchResult?: {
    SearchResultItems?: USAJobsSearchItem[];
  };
}

export const usajobsAdapter: JobSourceAdapter = {
  source: "usajobs",
  sourceType: "api",

  isConfigured(): boolean {
    return !!process.env.USAJOBS_API_KEY && !!process.env.USAJOBS_EMAIL;
  },

  async fetchJobs(region: string, radiusMiles: number): Promise<NormalizedJob[]> {
    const apiKey = process.env.USAJOBS_API_KEY;
    const email = process.env.USAJOBS_EMAIL;
    if (!apiKey || !email) return [];

    const params = new URLSearchParams({
      LocationName: region,
      Radius: String(radiusMiles),
      ResultsPerPage: "50",
    });

    // fetchJson (VQ-R-019) applies a 30s AbortSignal.timeout so a stalled
    // USAJobs response cannot hang the whole refresh sweep.
    const json = await fetchJson<USAJobsApiResponse>(`${USAJOBS_BASE}?${params}`, {
      headers: {
        "Authorization-Key": apiKey,
        "User-Agent": email,
        Host: "data.usajobs.gov",
      },
    });
    const items: USAJobsSearchItem[] = json?.SearchResult?.SearchResultItems ?? [];

    // mapEachJob isolates one malformed row (e.g. a missing
    // MatchedObjectDescriptor throwing on property access) from the rest of
    // the batch — see its doc comment in ./shared.
    return mapEachJob(items, "usajobs", (item) => {
      const desc = item.MatchedObjectDescriptor;
      const pay = desc.PositionRemuneration?.[0];
      const rateIntervalCode = pay?.RateIntervalCode;
      const label = rateIntervalCode ? (RATE_INTERVAL_LABELS[rateIntervalCode] ?? rateIntervalCode) : null;
      // The raw range is preserved in salaryRaw even when the period has no
      // fixed-hours convention (FB, PY, SY) or the code is unrecognized —
      // only the numeric salaryMin below is withheld.
      const salaryText = pay ? `$${pay.MinimumRange}-$${pay.MaximumRange}${label ? `/${label}` : ""}` : null;
      const period = rateIntervalCode ? RATE_INTERVAL_PERIODS[rateIntervalCode] : undefined;
      const minAmount = pay ? parseFloat(pay.MinimumRange) : null;
      const salaryMin = period ? hourlyFromAmount(minAmount, period) : null;

      return {
        title: desc.PositionTitle,
        company: desc.OrganizationName,
        location: desc.PositionLocationDisplay,
        workMode: inferJobWorkMode({
          source: "usajobs",
          title: desc.PositionTitle,
          company: desc.OrganizationName,
          location: desc.PositionLocationDisplay,
          description: desc.QualificationSummary,
        }),
        salary: salaryText,
        salaryMin,
        description: desc.QualificationSummary?.slice(0, 5000) ?? "",
        url: desc.PositionURI,
        source: "usajobs",
        sourceType: "api" as const,
        sourceId: `usajobs:${item.MatchedObjectId}`,
      };
    });
  },
};
