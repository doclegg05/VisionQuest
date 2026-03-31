import type { JobSourceAdapter, NormalizedJob } from "../types";
import { parseSalaryToHourly } from "../salary-parser";
import { logger } from "@/lib/logger";

/**
 * USAJobs adapter — official federal government job listings API.
 * Requires: USAJOBS_API_KEY and USAJOBS_EMAIL
 */

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

    try {
      const params = new URLSearchParams({
        LocationName: region,
        Radius: String(radiusMiles),
        ResultsPerPage: "50",
      });

      const res = await fetch(`${USAJOBS_BASE}?${params}`, {
        headers: {
          "Authorization-Key": apiKey,
          "User-Agent": email,
          Host: "data.usajobs.gov",
        },
      });

      if (!res.ok) {
        logger.error("USAJobs API error", { status: res.status });
        return [];
      }

      const json = await res.json();
      const items: USAJobsSearchItem[] =
        json.SearchResult?.SearchResultItems ?? [];

      return items.map((item) => {
        const desc = item.MatchedObjectDescriptor;
        const pay = desc.PositionRemuneration?.[0];
        const salaryText = pay
          ? `$${pay.MinimumRange}-$${pay.MaximumRange}/${pay.RateIntervalCode === "PA" ? "year" : "hr"}`
          : null;

        return {
          title: desc.PositionTitle,
          company: desc.OrganizationName,
          location: desc.PositionLocationDisplay,
          salary: salaryText,
          salaryMin: parseSalaryToHourly(salaryText),
          description: desc.QualificationSummary?.slice(0, 5000) ?? "",
          url: desc.PositionURI,
          source: "usajobs",
          sourceType: "api" as const,
          sourceId: `usajobs:${item.MatchedObjectId}`,
        };
      });
    } catch (err) {
      logger.error("USAJobs adapter error", { error: String(err) });
      return [];
    }
  },
};
