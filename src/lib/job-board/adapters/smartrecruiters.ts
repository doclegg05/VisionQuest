import type { JobSourceAdapter, NormalizedJob } from "../types";
import { inferJobWorkMode } from "../work-mode";
import { fetchJson, textMatchesQuery } from "./shared";

const DEFAULT_SMARTRECRUITERS = [
  "Visa",
  "BoschGroup",
  "McDonaldsCorporation",
  "LVMH",
] as const;

interface SmartRecruitersLocation {
  city?: string;
  region?: string;
  country?: string;
  fullLocation?: string;
  remote?: boolean;
}

interface SmartRecruitersPosting {
  id?: string;
  name?: string;
  company?: { name?: string };
  location?: SmartRecruitersLocation;
}

interface SmartRecruitersResponse {
  content?: SmartRecruitersPosting[];
}

function formatLocation(location: SmartRecruitersLocation | undefined): string {
  if (!location) return "";
  if (location.remote && !location.fullLocation && !location.city && !location.region) return "Remote";
  return (
    location.fullLocation ||
    [location.city, location.region, location.country?.toUpperCase()].filter(Boolean).join(", ")
  );
}

function keepForClassRegion(region: string, location: SmartRecruitersLocation | undefined): boolean {
  const locationText = formatLocation(location);
  return !region.trim() || Boolean(location?.remote) || textMatchesQuery(region, locationText);
}

export const smartRecruitersAdapter: JobSourceAdapter = {
  source: "smartrecruiters",
  sourceType: "api",

  isConfigured(): boolean {
    return true;
  },

  async fetchJobs(region: string): Promise<NormalizedJob[]> {
    const out: NormalizedJob[] = [];

    for (const company of DEFAULT_SMARTRECRUITERS) {
      const params = new URLSearchParams({ limit: "100", country: "us" });
      const data = await fetchJson<SmartRecruitersResponse>(
        `https://api.smartrecruiters.com/v1/companies/${company}/postings?${params}`,
      );

      for (const posting of data?.content ?? []) {
        const location = formatLocation(posting.location);
        if (!posting.id || !posting.name || !keepForClassRegion(region, posting.location)) continue;

        out.push({
          title: posting.name,
          company: posting.company?.name || company,
          location,
          workMode: inferJobWorkMode({
            source: "smartrecruiters",
            title: posting.name,
            company: posting.company?.name || company,
            location,
            remote: posting.location?.remote,
          }),
          salary: null,
          salaryMin: null,
          description: `${posting.name} - ${location}`,
          url: `https://jobs.smartrecruiters.com/${company}/${posting.id}`,
          source: "smartrecruiters",
          sourceType: "api",
          sourceId: `smartrecruiters:${company}:${posting.id}`,
        });
        if (out.length >= 60) return out;
      }
    }

    return out;
  },
};
