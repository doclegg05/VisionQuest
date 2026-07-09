/**
 * CareerOneStop counseling client — read-only career-exploration lookups for
 * Sage: Skills Matcher (RIASEC-aligned self-assessment), occupation search and
 * profiles, wage percentiles, tools & technology, and local training programs.
 *
 * Contract shared by every function here:
 *  - Degrades gracefully when COS_USER_ID / COS_API_TOKEN are absent:
 *    returns `{ configured: false }` plus an empty payload. Nothing throws at
 *    import time or call time.
 *  - Zod-validates every vendor response before shaping it — malformed or
 *    oversized bodies become `error: "bad_response"`, never a crash.
 *  - Every request carries an AbortSignal timeout; failures map to typed
 *    error codes. Raw errors and credential values never reach callers or
 *    logs (we log an endpoint label + status only, because request paths
 *    embed the account user id).
 *
 * Endpoint paths and response shapes were verified against the PUBLIC API
 * explorer docs (api.careeronestop.org/api-explorer) on 2026-07-09. They have
 * NOT been exercised against the live authenticated API from this codebase —
 * see the per-endpoint notes below.
 */

import { z } from "zod";
import { logger } from "@/lib/logger";
import { COS_API_BASE, careerOneStopCredentials } from "./careeronestop-config";

// Interactive-chat budget — deliberately tighter than the 30s batch timeout
// used by the job-search cron adapter.
const REQUEST_TIMEOUT_MS = 12_000;
// Reject absurdly large bodies before JSON.parse can balloon memory.
const MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_LOCATION = "WV"; // SPOKES students are West Virginia based.
const DEFAULT_TRAINING_RADIUS_MILES = 50;

export type CounselingErrorCode =
  | "unauthorized" // 401/403 — key rejected
  | "not_found" // 404 — no such occupation/resource
  | "timeout" // request exceeded REQUEST_TIMEOUT_MS (or caller aborted)
  | "network" // fetch itself failed (DNS, connection reset, ...)
  | "bad_response" // non-JSON, schema-violating, or oversized body
  | "http_error"; // any other non-2xx status

interface CounselingEnvelope {
  /** False when COS env keys are absent — payload is empty, not an error. */
  configured: boolean;
  error?: CounselingErrorCode;
}

interface RequestOptions {
  signal?: AbortSignal;
}

// -----------------------------------------------------------------------------
// Transport
// -----------------------------------------------------------------------------

type CosFetchResult =
  | { ok: true; body: unknown }
  | { ok: false; error: CounselingErrorCode };

function errorCodeForStatus(status: number): CounselingErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  return "http_error";
}

/**
 * One guarded round-trip to the CareerOneStop API. `endpoint` is a static
 * label used for logging INSTEAD of the URL — paths embed COS_USER_ID.
 */
async function cosRequest(
  endpoint: string,
  path: string,
  token: string,
  options: {
    method?: "GET" | "POST";
    query?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<CosFetchResult> {
  const url = new URL(`${COS_API_BASE}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const code: CounselingErrorCode =
      name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
    logger.warn("careeronestop counseling request failed", { endpoint, code });
    return { ok: false, error: code };
  }

  if (!response.ok) {
    const code = errorCodeForStatus(response.status);
    logger.warn("careeronestop counseling request rejected", {
      endpoint,
      status: response.status,
      code,
    });
    return { ok: false, error: code };
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_RESPONSE_BYTES) {
    logger.warn("careeronestop counseling response oversized", { endpoint, declaredLength });
    return { ok: false, error: "bad_response" };
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false, error: "network" };
  }
  if (text.length > MAX_RESPONSE_BYTES) {
    logger.warn("careeronestop counseling response oversized", {
      endpoint,
      bytes: text.length,
    });
    return { ok: false, error: "bad_response" };
  }

  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    logger.warn("careeronestop counseling response was not JSON", { endpoint });
    return { ok: false, error: "bad_response" };
  }
}

/** Validate a raw body against a schema, collapsing failure to bad_response. */
function parseBody<T>(
  endpoint: string,
  body: unknown,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false; error: CounselingErrorCode } {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    logger.warn("careeronestop counseling response failed validation", { endpoint });
    return { ok: false, error: "bad_response" };
  }
  return { ok: true, data: parsed.data };
}

// Vendor payloads mix numbers and numeric strings ("37.02", 2.1) field by
// field; validate structure strictly and value types leniently.
const numberish = z.union([z.string(), z.number()]);

function asDisplayNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value: string | null | undefined, max = 600): string | null {
  const collapsed = (value ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

// -----------------------------------------------------------------------------
// Skills Matcher
// GET  /v1/skillsmatcher/{userId}   — the 40 self-rating questions
// POST /v1/skillsmatcher/{userId}   — submit ratings, get matched occupations
// -----------------------------------------------------------------------------

const skillsQuestionSchema = z.object({
  ElementId: z.string(),
  ElementName: z.string().nullish(),
  Question: z.string().nullish(),
  EasyReadDescription: z.string().nullish(),
  AnchorFirst: z.string().nullish(),
  AnchorLast: z.string().nullish(),
  DataPoint20: numberish.nullish(),
  DataPoint35: numberish.nullish(),
  DataPoint50: numberish.nullish(),
  DataPoint65: numberish.nullish(),
  DataPoint80: numberish.nullish(),
});

const skillsQuestionsResponseSchema = z.object({
  Skills: z.array(skillsQuestionSchema),
});

const skillsSubmitResponseSchema = z.object({
  SKARankList: z
    .array(
      z.object({
        OnetCode: z.string().nullish(),
        OccupationTitle: z.string().nullish(),
        Rank: numberish.nullish(),
        Score: numberish.nullish(),
        Outlook: z.string().nullish(),
        AnnualWages: numberish.nullish(),
        TypicalEducation: z.string().nullish(),
      }),
    )
    .nullish(),
});

export interface SkillsMatcherQuestion {
  elementId: string;
  skillName: string;
  question: string;
  easyReadDescription: string | null;
  /** Plain-language anchors for rating 1 and rating 5. */
  lowestLabel: string | null;
  highestLabel: string | null;
}

export interface SkillsMatcherQuestionsResult extends CounselingEnvelope {
  questions: SkillsMatcherQuestion[];
}

export interface SkillsMatcherAnswer {
  elementId: string;
  /** Student self-rating, 1 (just starting) through 5 (expert). */
  rating: number;
}

export const skillsMatcherAnswerSchema = z.object({
  elementId: z.string().min(1).max(80),
  rating: z.number().int().min(1).max(5),
});

export interface SkillsMatcherMatch {
  onetCode: string;
  title: string;
  rank: number | null;
  outlook: string | null;
  typicalEducation: string | null;
  medianAnnualWage: number | null;
}

export interface SkillsMatcherMatchesResult extends CounselingEnvelope {
  matches: SkillsMatcherMatch[];
}

export async function fetchSkillsMatcherQuestions(
  options: RequestOptions = {},
): Promise<SkillsMatcherQuestionsResult> {
  const credentials = careerOneStopCredentials();
  if (!credentials) return { configured: false, questions: [] };

  const result = await cosRequest(
    "skillsmatcher.questions",
    `/v1/skillsmatcher/${encodeURIComponent(credentials.userId)}`,
    credentials.token,
    { signal: options.signal },
  );
  if (!result.ok) return { configured: true, error: result.error, questions: [] };

  const parsed = parseBody("skillsmatcher.questions", result.body, skillsQuestionsResponseSchema);
  if (!parsed.ok) return { configured: true, error: parsed.error, questions: [] };

  return {
    configured: true,
    questions: parsed.data.Skills.map((skill) => ({
      elementId: skill.ElementId,
      skillName: cleanText(skill.ElementName, 120) ?? skill.ElementId,
      question: cleanText(skill.Question, 400) ?? "",
      easyReadDescription: cleanText(skill.EasyReadDescription, 400),
      lowestLabel: cleanText(skill.AnchorFirst, 160),
      highestLabel: cleanText(skill.AnchorLast, 160),
    })),
  };
}

/**
 * Submit self-ratings and return best-fit occupations. Ratings 1–5 are mapped
 * onto each question's own DataPoint20/35/50/65/80 scale values, which is what
 * the API expects as DataValue (per the API-explorer docs; unverified against
 * the live service — partial answer sets in particular may be rejected).
 */
export async function submitSkillsMatcher(
  answers: SkillsMatcherAnswer[],
  options: RequestOptions = {},
): Promise<SkillsMatcherMatchesResult> {
  const credentials = careerOneStopCredentials();
  if (!credentials) return { configured: false, matches: [] };

  const validated = z.array(skillsMatcherAnswerSchema).min(1).max(60).safeParse(answers);
  if (!validated.success) {
    return { configured: true, error: "bad_response", matches: [] };
  }

  // The DataValue for each answer must come from that element's own scale, so
  // pull the current question set first and translate ratings through it.
  const questionsResult = await cosRequest(
    "skillsmatcher.questions",
    `/v1/skillsmatcher/${encodeURIComponent(credentials.userId)}`,
    credentials.token,
    { signal: options.signal },
  );
  if (!questionsResult.ok) {
    return { configured: true, error: questionsResult.error, matches: [] };
  }
  const questions = parseBody(
    "skillsmatcher.questions",
    questionsResult.body,
    skillsQuestionsResponseSchema,
  );
  if (!questions.ok) return { configured: true, error: questions.error, matches: [] };

  const scaleByElement = new Map(
    questions.data.Skills.map((skill) => [
      skill.ElementId,
      [skill.DataPoint20, skill.DataPoint35, skill.DataPoint50, skill.DataPoint65, skill.DataPoint80],
    ]),
  );

  const skaValueList: Array<{ ElementId: string; DataValue: string }> = [];
  for (const answer of validated.data) {
    const scale = scaleByElement.get(answer.elementId);
    const dataValue = asDisplayNumber(scale?.[answer.rating - 1]);
    if (dataValue === null) continue; // unknown element or gap in the scale — skip, don't guess
    skaValueList.push({ ElementId: answer.elementId, DataValue: String(dataValue) });
  }
  if (skaValueList.length === 0) {
    return { configured: true, error: "bad_response", matches: [] };
  }

  const result = await cosRequest(
    "skillsmatcher.submit",
    `/v1/skillsmatcher/${encodeURIComponent(credentials.userId)}`,
    credentials.token,
    { method: "POST", body: { SKAValueList: skaValueList }, signal: options.signal },
  );
  if (!result.ok) return { configured: true, error: result.error, matches: [] };

  const parsed = parseBody("skillsmatcher.submit", result.body, skillsSubmitResponseSchema);
  if (!parsed.ok) return { configured: true, error: parsed.error, matches: [] };

  const matches = (parsed.data.SKARankList ?? [])
    .filter((entry) => Boolean(entry.OnetCode && entry.OccupationTitle))
    .map((entry) => ({
      onetCode: entry.OnetCode as string,
      title: entry.OccupationTitle as string,
      rank: asDisplayNumber(entry.Rank),
      outlook: cleanText(entry.Outlook, 80),
      typicalEducation: cleanText(entry.TypicalEducation, 120),
      medianAnnualWage: asDisplayNumber(entry.AnnualWages),
    }))
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 10);

  return { configured: true, matches };
}

// -----------------------------------------------------------------------------
// Occupation search + profile
// GET /v1/occupation/{userId}/{keyword}/{dataLevelOnly}/{start}/{limit}
// GET /v1/occupation/{userId}/{codeOrTitle}/{location}?wages=&training=&tasks=
// -----------------------------------------------------------------------------

const occupationSearchResponseSchema = z.object({
  OccupationList: z
    .array(
      z.object({
        OnetTitle: z.string().nullish(),
        OnetCode: z.string().nullish(),
        OccupationDescription: z.string().nullish(),
      }),
    )
    .nullish(),
});

const wageEntrySchema = z.object({
  RateType: z.string().nullish(),
  Pct10: numberish.nullish(),
  Pct25: numberish.nullish(),
  Median: numberish.nullish(),
  Pct75: numberish.nullish(),
  Pct90: numberish.nullish(),
  AreaName: z.string().nullish(),
});

const wagesBlockSchema = z.object({
  NationalWagesList: z.array(wageEntrySchema).nullish(),
  StateWagesList: z.array(wageEntrySchema).nullish(),
  BLSAreaWagesList: z.array(wageEntrySchema).nullish(),
  WageYear: numberish.nullish(),
});

const occupationDetailSchema = z.object({
  OnetTitle: z.string().nullish(),
  OnetCode: z.string().nullish(),
  OnetDescription: z.string().nullish(),
  Wages: wagesBlockSchema.nullish(),
  EducationTraining: z
    .object({
      EducationTitle: z.string().nullish(),
      EducationType: z.string().nullish(),
      ExperienceTitle: z.string().nullish(),
      TrainingTitle: z.string().nullish(),
    })
    .nullish(),
  Tasks: z
    .array(z.object({ TaskDescription: z.string().nullish() }))
    .nullish(),
  BrightOutlook: z.string().nullish(),
});

const occupationProfileResponseSchema = z.object({
  OccupationDetail: z.array(occupationDetailSchema).nullish(),
  RecordCount: numberish.nullish(),
});

export interface OccupationSummary {
  onetCode: string;
  title: string;
  description: string | null;
}

export interface OccupationSearchResult extends CounselingEnvelope {
  occupations: OccupationSummary[];
}

export interface WagePercentiles {
  areaName: string | null;
  rateType: string | null;
  pct10: number | null;
  pct25: number | null;
  median: number | null;
  pct75: number | null;
  pct90: number | null;
}

export interface OccupationProfile {
  onetCode: string | null;
  title: string;
  description: string | null;
  typicalEducation: string | null;
  brightOutlook: string | null;
  tasks: string[];
  /** Median wages closest-to-home first (state entries before national). */
  wages: WagePercentiles[];
  wageYear: number | null;
}

export interface OccupationProfileResult extends CounselingEnvelope {
  profile: OccupationProfile | null;
}

export async function searchOccupations(
  keyword: string,
  options: RequestOptions & { limit?: number } = {},
): Promise<OccupationSearchResult> {
  const credentials = careerOneStopCredentials();
  if (!credentials) return { configured: false, occupations: [] };

  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const result = await cosRequest(
    "occupation.search",
    `/v1/occupation/${encodeURIComponent(credentials.userId)}/${encodeURIComponent(keyword)}/N/0/${limit}`,
    credentials.token,
    { signal: options.signal },
  );
  if (!result.ok) return { configured: true, error: result.error, occupations: [] };

  const parsed = parseBody("occupation.search", result.body, occupationSearchResponseSchema);
  if (!parsed.ok) return { configured: true, error: parsed.error, occupations: [] };

  return {
    configured: true,
    occupations: (parsed.data.OccupationList ?? [])
      .filter((entry) => Boolean(entry.OnetCode && entry.OnetTitle))
      .map((entry) => ({
        onetCode: entry.OnetCode as string,
        title: entry.OnetTitle as string,
        description: cleanText(entry.OccupationDescription),
      })),
  };
}

function shapeWageEntries(wages: z.infer<typeof wagesBlockSchema> | null | undefined): WagePercentiles[] {
  if (!wages) return [];
  const shape = (entry: z.infer<typeof wageEntrySchema>): WagePercentiles => ({
    areaName: cleanText(entry.AreaName, 80),
    rateType: cleanText(entry.RateType, 40),
    pct10: asDisplayNumber(entry.Pct10),
    pct25: asDisplayNumber(entry.Pct25),
    median: asDisplayNumber(entry.Median),
    pct75: asDisplayNumber(entry.Pct75),
    pct90: asDisplayNumber(entry.Pct90),
  });
  // State (local) numbers lead — they're the ones a WV student should hear.
  return [
    ...(wages.StateWagesList ?? []).map(shape),
    ...(wages.BLSAreaWagesList ?? []).map(shape),
    ...(wages.NationalWagesList ?? []).map(shape),
  ].filter((entry) => entry.median !== null || entry.pct25 !== null || entry.pct75 !== null);
}

export async function fetchOccupationProfile(
  codeOrTitle: string,
  options: RequestOptions & { location?: string } = {},
): Promise<OccupationProfileResult> {
  const credentials = careerOneStopCredentials();
  if (!credentials) return { configured: false, profile: null };

  const location = (options.location ?? DEFAULT_LOCATION).trim() || DEFAULT_LOCATION;
  const result = await cosRequest(
    "occupation.profile",
    `/v1/occupation/${encodeURIComponent(credentials.userId)}/${encodeURIComponent(codeOrTitle)}/${encodeURIComponent(location)}`,
    credentials.token,
    {
      query: { wages: "true", training: "true", tasks: "true" },
      signal: options.signal,
    },
  );
  if (!result.ok) return { configured: true, error: result.error, profile: null };

  const parsed = parseBody("occupation.profile", result.body, occupationProfileResponseSchema);
  if (!parsed.ok) return { configured: true, error: parsed.error, profile: null };

  const detail = (parsed.data.OccupationDetail ?? [])[0];
  if (!detail?.OnetTitle) {
    return { configured: true, error: "not_found", profile: null };
  }

  return {
    configured: true,
    profile: {
      onetCode: detail.OnetCode ?? null,
      title: detail.OnetTitle,
      description: cleanText(detail.OnetDescription),
      typicalEducation: cleanText(
        detail.EducationTraining?.EducationTitle ?? detail.EducationTraining?.EducationType,
        120,
      ),
      brightOutlook: cleanText(detail.BrightOutlook, 80),
      tasks: (detail.Tasks ?? [])
        .map((task) => cleanText(task.TaskDescription, 200))
        .filter((task): task is string => task !== null)
        .slice(0, 5),
      wages: shapeWageEntries(detail.Wages),
      wageYear: asDisplayNumber(detail.Wages?.WageYear),
    },
  };
}

// -----------------------------------------------------------------------------
// Wages (Compare Salaries)
// GET /v1/comparesalaries/{userId}/wage?keyword=&location=
// NOTE: OccupationDetail is an OBJECT here, unlike the occupation endpoints.
// -----------------------------------------------------------------------------

const compareSalariesResponseSchema = z.object({
  OccupationDetail: z
    .object({
      OccupationTitle: z.string().nullish(),
      OccupationCode: z.string().nullish(),
      Wages: wagesBlockSchema.nullish(),
    })
    .nullish(),
});

export interface OccupationWagesResult extends CounselingEnvelope {
  occupationTitle: string | null;
  onetCode: string | null;
  wageYear: number | null;
  wages: WagePercentiles[];
}

export async function fetchOccupationWages(
  codeOrTitle: string,
  options: RequestOptions & { location?: string } = {},
): Promise<OccupationWagesResult> {
  const credentials = careerOneStopCredentials();
  if (!credentials) {
    return { configured: false, occupationTitle: null, onetCode: null, wageYear: null, wages: [] };
  }

  const location = (options.location ?? DEFAULT_LOCATION).trim() || DEFAULT_LOCATION;
  const result = await cosRequest(
    "comparesalaries.wage",
    `/v1/comparesalaries/${encodeURIComponent(credentials.userId)}/wage`,
    credentials.token,
    { query: { keyword: codeOrTitle, location }, signal: options.signal },
  );
  if (!result.ok) {
    return {
      configured: true,
      error: result.error,
      occupationTitle: null,
      onetCode: null,
      wageYear: null,
      wages: [],
    };
  }

  const parsed = parseBody("comparesalaries.wage", result.body, compareSalariesResponseSchema);
  if (!parsed.ok) {
    return {
      configured: true,
      error: parsed.error,
      occupationTitle: null,
      onetCode: null,
      wageYear: null,
      wages: [],
    };
  }

  const detail = parsed.data.OccupationDetail;
  return {
    configured: true,
    occupationTitle: cleanText(detail?.OccupationTitle, 160),
    onetCode: detail?.OccupationCode ?? null,
    wageYear: asDisplayNumber(detail?.Wages?.WageYear),
    wages: shapeWageEntries(detail?.Wages),
  };
}

// -----------------------------------------------------------------------------
// Tools & Technology
// GET /v1/techtool/{userId}/{occupationCode}
// -----------------------------------------------------------------------------

const techToolCategorySchema = z.object({
  Title: z.string().nullish(),
  Examples: z
    .array(z.object({ Name: z.string().nullish() }))
    .nullish(),
});

const techToolResponseSchema = z.object({
  TechToolOccupationDetails: z
    .object({
      OnetCode: z.string().nullish(),
      OnetTitle: z.string().nullish(),
      Tools: z.object({ Categories: z.array(techToolCategorySchema).nullish() }).nullish(),
      Technology: z.object({ CategoryList: z.array(techToolCategorySchema).nullish() }).nullish(),
    })
    .nullish(),
});

export interface ToolTechCategory {
  category: string;
  examples: string[];
}

export interface ToolsAndTechnologyResult extends CounselingEnvelope {
  onetCode: string | null;
  occupationTitle: string | null;
  tools: ToolTechCategory[];
  technology: ToolTechCategory[];
}

function shapeToolCategories(
  categories: Array<z.infer<typeof techToolCategorySchema>> | null | undefined,
  maxCategories = 6,
  maxExamples = 5,
): ToolTechCategory[] {
  return (categories ?? [])
    .map((category) => ({
      category: cleanText(category.Title, 120) ?? "",
      examples: (category.Examples ?? [])
        .map((example) => cleanText(example.Name, 120))
        .filter((name): name is string => name !== null)
        .slice(0, maxExamples),
    }))
    .filter((category) => category.category.length > 0 && category.examples.length > 0)
    .slice(0, maxCategories);
}

export async function fetchToolsAndTechnology(
  onetCode: string,
  options: RequestOptions = {},
): Promise<ToolsAndTechnologyResult> {
  const credentials = careerOneStopCredentials();
  if (!credentials) {
    return { configured: false, onetCode: null, occupationTitle: null, tools: [], technology: [] };
  }

  const result = await cosRequest(
    "techtool.byOccupation",
    `/v1/techtool/${encodeURIComponent(credentials.userId)}/${encodeURIComponent(onetCode)}`,
    credentials.token,
    { signal: options.signal },
  );
  if (!result.ok) {
    return {
      configured: true,
      error: result.error,
      onetCode: null,
      occupationTitle: null,
      tools: [],
      technology: [],
    };
  }

  const parsed = parseBody("techtool.byOccupation", result.body, techToolResponseSchema);
  if (!parsed.ok) {
    return {
      configured: true,
      error: parsed.error,
      onetCode: null,
      occupationTitle: null,
      tools: [],
      technology: [],
    };
  }

  const detail = parsed.data.TechToolOccupationDetails;
  return {
    configured: true,
    onetCode: detail?.OnetCode ?? null,
    occupationTitle: cleanText(detail?.OnetTitle, 160),
    tools: shapeToolCategories(detail?.Tools?.Categories),
    technology: shapeToolCategories(detail?.Technology?.CategoryList),
  };
}

// -----------------------------------------------------------------------------
// Training programs (Training Finder v2)
// GET /v2/training/programs/{userId}/{keyword}/{location}/{radius}/{programLength}
//     /{school}/{programName}/{programFormat}/{occupation}/{filterBySource}
//     /{area}/{sortColumns}/{sortDirection}/{startRecord}/{limitRecord}
// Unused filter segments are passed as "0" (CareerOneStop path convention;
// unverified against the live service).
// -----------------------------------------------------------------------------

const trainingProgramsResponseSchema = z.object({
  SchoolPrograms: z
    .array(
      z.object({
        SchoolName: z.string().nullish(),
        EtaProgramName: z.string().nullish(),
        CipTitle: z.string().nullish(),
        AwardLevel: z.string().nullish(),
        Credential: z.string().nullish(),
        City: z.string().nullish(),
        StateAbbr: z.string().nullish(),
        SchoolURL: z.string().nullish(),
        Distance: numberish.nullish(),
      }),
    )
    .nullish(),
  RecordCount: numberish.nullish(),
});

export interface TrainingProgram {
  school: string;
  program: string | null;
  credential: string | null;
  city: string | null;
  state: string | null;
  url: string | null;
  distanceMiles: number | null;
}

export interface TrainingProgramsResult extends CounselingEnvelope {
  programs: TrainingProgram[];
  totalCount: number;
}

export async function fetchTrainingPrograms(
  keyword: string,
  options: RequestOptions & { location?: string; limit?: number } = {},
): Promise<TrainingProgramsResult> {
  const credentials = careerOneStopCredentials();
  if (!credentials) return { configured: false, programs: [], totalCount: 0 };

  const location = (options.location ?? DEFAULT_LOCATION).trim() || DEFAULT_LOCATION;
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const path = [
    "/v2/training/programs",
    encodeURIComponent(credentials.userId),
    encodeURIComponent(keyword),
    encodeURIComponent(location),
    String(DEFAULT_TRAINING_RADIUS_MILES),
    "0", // programLength
    "0", // school
    "0", // programName
    "0", // programFormat
    "0", // occupation
    "0", // filterBySource
    "0", // area
    "0", // sortColumns (default relevance)
    "0", // sortDirection
    "0", // startRecord
    String(limit),
  ].join("/");

  const result = await cosRequest("training.programs", path, credentials.token, {
    signal: options.signal,
  });
  if (!result.ok) return { configured: true, error: result.error, programs: [], totalCount: 0 };

  const parsed = parseBody("training.programs", result.body, trainingProgramsResponseSchema);
  if (!parsed.ok) return { configured: true, error: parsed.error, programs: [], totalCount: 0 };

  const programs = (parsed.data.SchoolPrograms ?? [])
    .filter((entry) => Boolean(entry.SchoolName))
    .map((entry) => ({
      school: cleanText(entry.SchoolName, 160) as string,
      program: cleanText(entry.EtaProgramName ?? entry.CipTitle, 160),
      credential: cleanText(entry.Credential ?? entry.AwardLevel, 120),
      city: cleanText(entry.City, 80),
      state: cleanText(entry.StateAbbr, 10),
      url: cleanText(entry.SchoolURL, 400),
      distanceMiles: asDisplayNumber(entry.Distance),
    }))
    .slice(0, limit);

  return {
    configured: true,
    programs,
    totalCount: asDisplayNumber(parsed.data.RecordCount) ?? programs.length,
  };
}
