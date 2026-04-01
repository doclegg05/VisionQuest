import { logger } from "@/lib/logger";

import { extractProviderQuotaSnapshots } from "../limits";
import { getPrimarySearchTerm } from "../profile";
import type {
  JobFetchResult,
  JobSearchProfile,
  JobSourceAdapter,
  NormalizedJob,
  ProviderQuotaSnapshot,
} from "../types";

const CAREERONESTOP_BASE = "https://api.careeronestop.org";

interface CareerOneStopJob {
  JvId: string;
  JobTitle: string;
  Company: string;
  DescriptionSnippet: string;
  URL: string;
  Location: string;
}

interface CareerOneStopJobsResponse {
  ErrorMessage?: string;
  Jobs?: CareerOneStopJob[];
}

interface CareerOneStopTrainingProgram {
  ID?: string;
  SchoolName?: string;
  SchoolUrl?: string;
  ProgramName?: string;
  ProgramLength?: string;
  ProgramLengthValue?: string;
  SchoolAddress?: string;
  City?: string;
  StateAbbr?: string;
  Zip?: string;
  ProgramDescription?: string;
  TuitionAndFees?: string;
  TotalCost?: string;
}

interface CareerOneStopTrainingResponse {
  ErrorMessage?: string;
  SchoolPrograms?: CareerOneStopTrainingProgram[];
}

interface CareerOneStopApprenticeshipOffice {
  ID?: string;
  Organization?: string;
  Name?: string;
  OfficeName?: string;
  Address?: string;
  City?: string;
  StateAbbr?: string;
  Zip?: string;
  Phone?: string;
  Email?: string;
  Website?: string;
  Description?: string;
}

interface CareerOneStopApprenticeshipResponse {
  ErrorMessage?: string;
  ApprenticeshipOffices?: CareerOneStopApprenticeshipOffice[];
}

function buildPath(...segments: Array<string | number>) {
  return `/${segments.map((segment) => encodeURIComponent(String(segment))).join("/")}`;
}

function appendQuotaSnapshots(
  current: ProviderQuotaSnapshot[],
  source: "careeronestop",
  headers: Headers,
) {
  for (const snapshot of extractProviderQuotaSnapshots(source, headers)) {
    current.push(snapshot);
  }
}

function buildJobSearchPath(userId: string, region: string, radiusMiles: number) {
  return buildPath(
    "v2",
    "jobsearch",
    userId,
    0,
    region,
    radiusMiles,
    0,
    0,
    0,
    50,
    30,
  );
}

function buildTrainingPath(userId: string, region: string, occupation: string | null) {
  return buildPath(
    "v1",
    "training",
    userId,
    region,
    occupation ?? 0,
    0,
    0,
    0,
    0,
    0,
    0,
    30,
  );
}

function buildApprenticeshipPath(userId: string, region: string, radiusMiles: number) {
  return buildPath("v1", "apprenticeshipfinder", userId, region, radiusMiles);
}

function getLocationLabel(parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(", ");
}

function compactText(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" ").trim();
}

async function fetchCareerOneStopJobs(
  profile: JobSearchProfile,
  apiToken: string,
  userId: string,
  quotaSnapshots: ProviderQuotaSnapshot[],
): Promise<NormalizedJob[]> {
  const url = new URL(
    buildJobSearchPath(userId, profile.region, profile.radiusMiles),
    CAREERONESTOP_BASE,
  );
  url.searchParams.set("enableJobDescriptionSnippet", "true");
  const primarySearchTerm = getPrimarySearchTerm(profile);
  if (primarySearchTerm) {
    url.searchParams.set("keyword", primarySearchTerm);
  }
  if (profile.remoteOnly) {
    url.searchParams.set("telecommute", "true");
  }

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
  });
  appendQuotaSnapshots(quotaSnapshots, "careeronestop", res.headers);

  if (!res.ok) {
    logger.error("CareerOneStop jobs API error", { status: res.status });
    return [];
  }

  const json = (await res.json()) as CareerOneStopJobsResponse;
  if (json.ErrorMessage) {
    logger.warn("CareerOneStop jobs API returned an application error", { error: json.ErrorMessage });
  }

  return (json.Jobs ?? []).map((job) => ({
    opportunityType: "job",
    title: job.JobTitle,
    company: job.Company || "CareerOneStop",
    location: job.Location ?? profile.region,
    salary: null,
    salaryMin: null,
    description: job.DescriptionSnippet?.slice(0, 5000) ?? "",
    url: job.URL,
    source: "careeronestop",
    sourceType: "api",
    sourceId: `careeronestop:job:${job.JvId}`,
  }));
}

async function fetchCareerOneStopTrainingPrograms(
  profile: JobSearchProfile,
  apiToken: string,
  userId: string,
  quotaSnapshots: ProviderQuotaSnapshot[],
): Promise<NormalizedJob[]> {
  const url = new URL(
    buildTrainingPath(userId, profile.region, getPrimarySearchTerm(profile)),
    CAREERONESTOP_BASE,
  );
  url.searchParams.set("radius", String(profile.radiusMiles));

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
  });
  appendQuotaSnapshots(quotaSnapshots, "careeronestop", res.headers);

  if (!res.ok) {
    logger.error("CareerOneStop training API error", { status: res.status });
    return [];
  }

  const json = (await res.json()) as CareerOneStopTrainingResponse;
  if (json.ErrorMessage) {
    logger.warn("CareerOneStop training API returned an application error", { error: json.ErrorMessage });
  }

  return (json.SchoolPrograms ?? []).map((program, index) => {
    const location = getLocationLabel([
      compactText([program.City, program.StateAbbr]),
      program.Zip,
    ]);
    const title = program.ProgramName || "Training Program";
    const provider = program.SchoolName || "CareerOneStop Training";
    const programLength = compactText([program.ProgramLength, program.ProgramLengthValue]);
    const cost = program.TotalCost || program.TuitionAndFees || null;

    return {
      opportunityType: "training",
      title,
      company: provider,
      location: location || profile.region,
      salary: cost ? `Estimated cost: ${cost}` : null,
      salaryMin: null,
      description: compactText([
        program.ProgramDescription,
        programLength ? `Program length: ${programLength}.` : null,
        cost ? `Estimated cost: ${cost}.` : null,
        program.SchoolAddress ? `Address: ${program.SchoolAddress}.` : null,
      ]).slice(0, 5000),
      url: program.SchoolUrl || "https://www.careeronestop.org/",
      source: "careeronestop",
      sourceType: "api",
      sourceId: `careeronestop:training:${program.ID ?? `${provider}:${title}:${index}`}`,
    };
  });
}

async function fetchCareerOneStopApprenticeshipOffices(
  profile: JobSearchProfile,
  apiToken: string,
  userId: string,
  quotaSnapshots: ProviderQuotaSnapshot[],
): Promise<NormalizedJob[]> {
  const url = new URL(
    buildApprenticeshipPath(userId, profile.region, profile.radiusMiles),
    CAREERONESTOP_BASE,
  );

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
  });
  appendQuotaSnapshots(quotaSnapshots, "careeronestop", res.headers);

  if (!res.ok) {
    logger.error("CareerOneStop apprenticeship API error", { status: res.status });
    return [];
  }

  const json = (await res.json()) as CareerOneStopApprenticeshipResponse;
  if (json.ErrorMessage) {
    logger.warn("CareerOneStop apprenticeship API returned an application error", {
      error: json.ErrorMessage,
    });
  }

  return (json.ApprenticeshipOffices ?? []).map((office, index) => {
    const title = office.OfficeName || office.Name || office.Organization || "Apprenticeship Support";
    const provider = office.Organization || office.Name || "CareerOneStop Apprenticeship";
    const location = getLocationLabel([
      compactText([office.City, office.StateAbbr]),
      office.Zip,
    ]);
    const contact = compactText([
      office.Phone ? `Phone: ${office.Phone}.` : null,
      office.Email ? `Email: ${office.Email}.` : null,
      office.Address ? `Address: ${office.Address}.` : null,
    ]);

    return {
      opportunityType: "apprenticeship",
      title,
      company: provider,
      location: location || profile.region,
      salary: null,
      salaryMin: null,
      description: compactText([
        office.Description,
        "Registered apprenticeship office and support contact.",
        contact,
      ]).slice(0, 5000),
      url: office.Website || "https://www.apprenticeship.gov/",
      source: "careeronestop",
      sourceType: "api",
      sourceId: `careeronestop:apprenticeship:${office.ID ?? `${provider}:${location}:${index}`}`,
    };
  });
}

export const careerOneStopAdapter: JobSourceAdapter = {
  source: "careeronestop",
  sourceType: "api",

  isConfigured(): boolean {
    return !!process.env.CAREERONESTOP_API_TOKEN && !!process.env.CAREERONESTOP_USER_ID;
  },

  async fetchJobs(profile: JobSearchProfile): Promise<JobFetchResult> {
    const apiToken = process.env.CAREERONESTOP_API_TOKEN;
    const userId = process.env.CAREERONESTOP_USER_ID;
    if (!apiToken || !userId) return { jobs: [] };

    const quotaSnapshots: ProviderQuotaSnapshot[] = [];

    try {
      const jobs: NormalizedJob[] = [];

      if (profile.opportunityTypes.includes("job")) {
        jobs.push(...await fetchCareerOneStopJobs(profile, apiToken, userId, quotaSnapshots));
      }
      if (profile.opportunityTypes.includes("training")) {
        jobs.push(...await fetchCareerOneStopTrainingPrograms(profile, apiToken, userId, quotaSnapshots));
      }
      if (profile.opportunityTypes.includes("apprenticeship")) {
        jobs.push(
          ...await fetchCareerOneStopApprenticeshipOffices(profile, apiToken, userId, quotaSnapshots),
        );
      }

      return { jobs, quotaSnapshots };
    } catch (error) {
      logger.error("CareerOneStop adapter error", { error: String(error) });
      return { jobs: [], quotaSnapshots };
    }
  },
};
