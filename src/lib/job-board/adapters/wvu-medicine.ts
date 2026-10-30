import type { JobSourceAdapter, NormalizedJob } from "../types";
import { inferEmploymentType } from "../employment-type";
import { inferJobWorkMode } from "../work-mode";
import { fetchJson, stripHtml, truncateDescription } from "./shared";

// Public career-site responses verified 2026-10-30. This is the employer's
// website service, not a versioned partner API; fail visibly on shape drift.
const ORIGIN = "https://wvumedicine.wd1.myworkdayjobs.com";
const API_BASE = `${ORIGIN}/wday/cxs/wvumedicine/WVUH`;
const BOARD = `${ORIGIN}/en-US/WVUH`;
const PAGE_SIZE = 20;
const MAX_PAGES = 3;
const MAX_DETAILS = 30;
// Node fetch otherwise sends Accept-Language: *, which this Workday site
// rejects with HTTP 500 (verified against the public service).
const JSON_HEADERS = { Accept: "application/json", "Accept-Language": "en-US" };

interface PostingSummary {
  title?: string;
  externalPath?: string;
  locationsText?: string;
}

interface SearchResponse {
  total?: number;
  jobPostings?: PostingSummary[];
}

interface DetailResponse {
  jobPostingInfo?: {
    title?: string;
    jobReqId?: string;
    location?: string;
    jobDescription?: string;
    timeType?: string;
    startDate?: string;
    canApply?: boolean;
    posted?: boolean;
  };
}

function cityForRegion(region: string): string {
  const [city, state, ...extra] = region.trim().split(",").map((part) => part.trim());
  if (!city || /^\d/.test(city) || extra.length || (state && !/^(wv|west virginia)$/i.test(state))) {
    throw new Error("WVU Medicine searches need a city in West Virginia, such as Summersville, WV.");
  }
  return city;
}

function locationMatchesCity(location: string, city: string): boolean {
  const normalize = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  return normalize(location).includes(normalize(city));
}

function safeJobPath(value: unknown): value is string {
  return typeof value === "string" && /^\/job\/[a-z0-9_/-]+$/i.test(value);
}

/**
 * Keyless, employer-direct WV jobs. Search is by city, not a measured radius;
 * keep this source in mixed mode so proximity uses the actual location.
 * Search text can match descriptions or multi-location roles, so every detail
 * must name the requested city before we put it on that class's board.
 */
export const wvuMedicineAdapter: JobSourceAdapter = {
  source: "wvumedicine",
  sourceType: "api",
  isConfigured: () => true,

  async fetchJobs(region: string): Promise<NormalizedJob[]> {
    const city = cityForRegion(region);
    const summaries = new Map<string, PostingSummary>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await fetchJson<SearchResponse>(`${API_BASE}/jobs`, {
        method: "POST",
        headers: { ...JSON_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: PAGE_SIZE, offset: page * PAGE_SIZE, searchText: city }),
      });
      if (!response) throw new Error("WVU Medicine job search could not be reached.");
      if (!Array.isArray(response.jobPostings) || typeof response.total !== "number") {
        throw new Error("WVU Medicine job search returned an unexpected response.");
      }
      for (const posting of response.jobPostings) {
        if (posting && safeJobPath(posting.externalPath)) summaries.set(posting.externalPath, posting);
      }
      if (response.jobPostings.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= response.total) break;
    }

    // Prioritize explicit facility-city matches before the detail request cap.
    const candidates = [...summaries.entries()].sort(([, a], [, b]) =>
      Number(locationMatchesCity(b.locationsText ?? "", city)) - Number(locationMatchesCity(a.locationsText ?? "", city)),
    ).slice(0, MAX_DETAILS);
    const jobs: NormalizedJob[] = [];
    let failures = 0;
    // Two public requests at a time, with a bounded number of pages/details.
    for (let offset = 0; offset < candidates.length; offset += 2) {
      const batch = await Promise.all(candidates.slice(offset, offset + 2).map(async ([path]) => {
        const detail = await fetchJson<DetailResponse>(`${API_BASE}${path}`, { headers: JSON_HEADERS });
        const info = detail?.jobPostingInfo;
        if (!info || typeof info.title !== "string" || typeof info.jobReqId !== "string" ||
            typeof info.location !== "string" || typeof info.jobDescription !== "string" ||
            typeof info.canApply !== "boolean" || typeof info.posted !== "boolean") {
          failures++;
          return null;
        }
        if (info.canApply !== true || info.posted !== true || !locationMatchesCity(info.location, city)) return null;
        const description = truncateDescription(stripHtml(info.jobDescription));
        const workMode = inferJobWorkMode({ title: info.title, location: info.location, description });
        const job: NormalizedJob = {
          title: info.title,
          company: "WVU Medicine",
          location: info.location,
          description,
          workMode,
          employmentType: inferEmploymentType({ title: info.title, description: info.timeType ?? "" }),
          salary: null,
          salaryMin: null,
          url: `${BOARD}${path}`,
          source: "wvumedicine",
          sourceType: "api",
          sourceId: `wvumedicine:${info.jobReqId}`,
        };
        if (info.startDate && /^\d{4}-\d{2}-\d{2}$/.test(info.startDate) && !Number.isNaN(Date.parse(info.startDate))) {
          job.postedAt = new Date(info.startDate).toISOString();
        }
        return job;
      }));
      for (const job of batch) if (job) jobs.push(job);
    }
    if (failures > 0 && jobs.length === 0) throw new Error("WVU Medicine job details could not be read. Try the refresh again.");
    return jobs;
  },
};
