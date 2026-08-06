/**
 * O*NET Web Services — My Next Move Mini Interest Profiler (30 questions).
 * Docs: https://services.onetcenter.org/reference/mnm/ip/ip_questions_30
 *       https://services.onetcenter.org/reference/mnm/ip/ip_results
 *       https://services.onetcenter.org/reference/mnm/ip/ip_interests
 */

import { z } from "zod";
import { logger } from "@/lib/logger";
import type { RiasecScores } from "@/lib/sage/discovery-extractor";
import { RIASEC_KEYS } from "@/lib/career/riasec-keys";
import { onetCredentials } from "./onet-config";

export const ONET_API_BASE = "https://api-v2.onetcenter.org";
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2_000_000;

export type OnetErrorCode =
  | "not_configured"
  | "unauthorized"
  | "timeout"
  | "network"
  | "bad_response"
  | "http_error";

export interface OnetAnswerOption {
  value: number;
  name: string;
}

export interface OnetQuestion {
  index: number;
  area: string;
  text: string;
}

export interface MiniIpQuestionsResult {
  configured: boolean;
  error?: OnetErrorCode;
  start?: number;
  end?: number;
  total?: number;
  answerOptions?: OnetAnswerOption[];
  questions?: OnetQuestion[];
}

export interface MiniIpResultsResult {
  configured: boolean;
  error?: OnetErrorCode;
  scores?: RiasecScores;
  rawScores?: RiasecScores;
}

export interface OnetInterestArea {
  code: string;
  title: string;
  description: string;
}

export interface RiasecInterestsResult {
  configured: boolean;
  error?: OnetErrorCode;
  interests?: OnetInterestArea[];
}

const questionsSchema = z.object({
  start: z.number().optional(),
  end: z.number().optional(),
  total: z.number().optional(),
  answer_option: z
    .array(z.object({ value: z.number(), name: z.string() }))
    .optional(),
  answer_options: z
    .array(z.object({ value: z.number(), name: z.string() }))
    .optional(),
  question: z
    .array(
      z.object({
        index: z.number(),
        area: z.string(),
        text: z.string(),
      }),
    )
    .optional(),
});

const resultsSchema = z.object({
  result: z.array(
    z.object({
      code: z.string(),
      score: z.number(),
      title: z.string().optional(),
      description: z.string().optional(),
    }),
  ),
});

const interestsSchema = z.object({
  interest: z
    .array(
      z.object({
        code: z.string(),
        title: z.string(),
        description: z.string(),
      }),
    )
    .optional(),
  interests: z
    .array(
      z.object({
        code: z.string(),
        title: z.string(),
        description: z.string(),
      }),
    )
    .optional(),
});

function basicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

async function onetGet(
  endpoint: string,
  path: string,
  query?: Record<string, string>,
): Promise<{ ok: true; body: unknown } | { ok: false; error: OnetErrorCode }> {
  const creds = onetCredentials();
  if (!creds) return { ok: false, error: "not_configured" };

  const url = new URL(`${ONET_API_BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: basicAuthHeader(creds.username, creds.password),
    };
    if (creds.apiKey) {
      headers["X-API-Key"] = creds.apiKey;
    }

    response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    logger.warn("O*NET request failed", { endpoint, error: name });
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, error: "timeout" };
    }
    return { ok: false, error: "network" };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: "unauthorized" };
  }
  if (!response.ok) {
    logger.warn("O*NET HTTP error", { endpoint, status: response.status });
    return { ok: false, error: "http_error" };
  }

  const buf = await response.arrayBuffer();
  if (buf.byteLength > MAX_RESPONSE_BYTES) {
    return { ok: false, error: "bad_response" };
  }

  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(buf)) };
  } catch {
    return { ok: false, error: "bad_response" };
  }
}

/**
 * Unaltered RIASEC interest titles/descriptions from O*NET Interest Profiler
 * services — used on the public attribution page (no login required).
 */
export async function fetchRiasecInterests(): Promise<RiasecInterestsResult> {
  if (!onetCredentials()) {
    return { configured: false, error: "not_configured" };
  }

  const result = await onetGet(
    "interestprofiler.interests",
    "/mnm/interestprofiler/interests/",
  );
  if (!result.ok) {
    return { configured: true, error: result.error };
  }

  const body = result.body;
  let rows: { code: string; title: string; description: string }[] | undefined;
  if (Array.isArray(body)) {
    const parsed = z
      .array(z.object({ code: z.string(), title: z.string(), description: z.string() }))
      .safeParse(body);
    if (!parsed.success) return { configured: true, error: "bad_response" };
    rows = parsed.data;
  } else {
    const parsed = interestsSchema.safeParse(body);
    if (!parsed.success) return { configured: true, error: "bad_response" };
    rows = parsed.data.interest ?? parsed.data.interests;
  }

  if (!rows?.length) {
    return { configured: true, error: "bad_response" };
  }

  return {
    configured: true,
    interests: rows.map((row) => ({
      code: row.code,
      title: row.title,
      description: row.description,
    })),
  };
}

/**
 * Fetch all 30 Mini-IP questions (paginated under the hood).
 */
export async function fetchMiniIpQuestions(): Promise<MiniIpQuestionsResult> {
  if (!onetCredentials()) {
    return { configured: false, error: "not_configured" };
  }

  const allQuestions: OnetQuestion[] = [];
  let answerOptions: OnetAnswerOption[] = [];
  let start = 1;
  let total = 30;

  while (allQuestions.length < total) {
    const end = Math.min(start + 11, total);
    const result = await onetGet("interestprofiler.questions_30", "/mnm/interestprofiler/questions_30", {
      start: String(start),
      end: String(end),
    });
    if (!result.ok) {
      return { configured: true, error: result.error };
    }
    const parsed = questionsSchema.safeParse(result.body);
    if (!parsed.success) {
      return { configured: true, error: "bad_response" };
    }
    const page = parsed.data;
    total = page.total ?? 30;
    const opts = page.answer_option ?? page.answer_options ?? [];
    if (opts.length > 0) answerOptions = opts;
    for (const q of page.question ?? []) {
      allQuestions.push(q);
    }
    if (!page.question?.length) break;
    start = end + 1;
    if (start > total) break;
  }

  return {
    configured: true,
    start: 1,
    end: allQuestions.length,
    total,
    answerOptions,
    questions: allQuestions.sort((a, b) => a.index - b.index),
  };
}

/**
 * Score a Mini-IP answer string (digits 1–5 in question order).
 */
export async function fetchMiniIpResults(answers: string): Promise<MiniIpResultsResult> {
  if (!onetCredentials()) {
    return { configured: false, error: "not_configured" };
  }

  const trimmed = answers.trim();
  if (!/^[1-5]{30}$/.test(trimmed) && !/^[1-5]{60}$/.test(trimmed)) {
    return { configured: true, error: "bad_response" };
  }

  const result = await onetGet("interestprofiler.results", "/mnm/interestprofiler/results", {
    answers: trimmed,
  });
  if (!result.ok) {
    return { configured: true, error: result.error };
  }

  const parsed = resultsSchema.safeParse(result.body);
  if (!parsed.success) {
    return { configured: true, error: "bad_response" };
  }

  const rawScores: RiasecScores = {
    realistic: 0,
    investigative: 0,
    artistic: 0,
    social: 0,
    enterprising: 0,
    conventional: 0,
  };

  for (const entry of parsed.data.result) {
    const code = entry.code.toLowerCase() as keyof RiasecScores;
    if ((RIASEC_KEYS as readonly string[]).includes(code)) {
      rawScores[code] = entry.score;
    }
  }

  return { configured: true, scores: rawScores, rawScores };
}
