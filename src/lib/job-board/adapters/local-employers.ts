import type { JobSourceAdapter, NormalizedJob } from "../types";
import { inferEmploymentType } from "../employment-type";
import { parseSalaryToHourly } from "../salary-parser";
import { fetchJson, stripHtml, truncateDescription } from "./shared";

// Employer-owned public Posting API boards. No applicant API or credentials.
const EMPLOYERS = ["Dominos", "PilotCompany"] as const;
const BASE = "https://api.smartrecruiters.com/v1/companies";
interface Posting {
  id?: string;
  name?: string;
  active?: boolean;
  company?: { name?: string };
  location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean };
  typeOfEmployment?: { label?: string };
  releasedDate?: string;
  jobAd?: { sections?: Record<string, { text?: string }> };
}

export const localEmployersAdapter: JobSourceAdapter = {
  source: "localemployers",
  sourceType: "api",
  isConfigured: () => true,
  async fetchJobs(region: string): Promise<NormalizedJob[]> {
    const [city, state, ...extra] = region.split(",").map((part) => part.trim());
    if (!city || /^\d/.test(city) || extra.length || (state && !/^(wv|west virginia)$/i.test(state))) {
      throw new Error("Local employers need a city in West Virginia, such as Charleston, WV.");
    }
    const jobs: NormalizedJob[] = [];
    let failures = 0;
    let successfulSearches = 0;
    for (const employer of EMPLOYERS) {
      const params = new URLSearchParams({ limit: "100", country: "us", region: "WV", city });
      const result = await fetchJson<{ content?: Posting[] }>(`${BASE}/${employer}/postings?${params}`);
      if (!result || !Array.isArray(result.content)) { failures++; continue; }
      successfulSearches++;
      const candidates = result.content.filter((posting) => posting && typeof posting.id === "string" && /^\d+$/.test(posting.id) &&
        posting.location?.city?.toLowerCase() === city.toLowerCase() &&
        posting.location.region?.toUpperCase() === "WV" && posting.location.country?.toLowerCase() === "us").slice(0, 20);
      for (let offset = 0; offset < candidates.length; offset += 2) {
        const details = await Promise.all(candidates.slice(offset, offset + 2).map((posting) =>
          fetchJson<Posting>(`${BASE}/${employer}/postings/${posting.id}`)));
        for (const detail of details) {
          if (!detail || typeof detail.name !== "string" || typeof detail.id !== "string" || !/^\d+$/.test(detail.id) || !detail.jobAd?.sections) {
            failures++; continue;
          }
          if (detail.active !== true || detail.location?.city?.toLowerCase() !== city.toLowerCase() ||
              detail.location.region?.toUpperCase() !== "WV" || detail.location.country?.toLowerCase() !== "us") continue;
          const description = truncateDescription(stripHtml(Object.values(detail.jobAd.sections).map((section) => typeof section?.text === "string" ? section.text : "").join("\n")));
          // Preserve only an employer-stated hourly range. Never turn a
          // numeric benefit, bonus or estimated salary into a wage.
          const salary = description.match(/\$[\d,.]+\s*(?:-|–|to)\s*\$[\d,.]+\s*(?:\/\s*(?:hour|hr)|per\s+hour)/i)?.[0] ?? null;
          jobs.push({
            title: detail.name, company: detail.company?.name || employer,
            location: `${detail.location.city}, WV`,
            workMode: detail.location.remote ? "remote" : detail.location.hybrid ? "hybrid" : "onsite",
            employmentType: inferEmploymentType({ description: detail.typeOfEmployment?.label }),
            description, salary, salaryMin: parseSalaryToHourly(salary),
            url: `https://jobs.smartrecruiters.com/${employer}/${detail.id}`,
            source: "localemployers", sourceType: "api", sourceId: `localemployers:${employer}:${detail.id}`,
            postedAt: detail.releasedDate && !Number.isNaN(Date.parse(detail.releasedDate)) ? new Date(detail.releasedDate).toISOString() : null,
          });
        }
      }
    }
    if (failures && (!successfulSearches || !jobs.length)) throw new Error("Some local employer feeds could not be read. Try the refresh again.");
    return jobs;
  },
};
