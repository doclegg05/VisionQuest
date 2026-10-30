import { AsyncLocalStorage } from "node:async_hooks";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import type { NormalizedJob } from "../types";

export const JOB_SCOUT_USER_AGENT = "VisionQuest Job Scout/0.1";

/**
 * What one adapter's requests did during a scrape. fetchJson and fetchText
 * return null on failure so a multi-board adapter can skip one dead board,
 * which also makes a total outage look like a source with no jobs. This tally
 * lets fetchSourceJobs tell the two apart (PR #248 review).
 */
interface SourceRequestTally {
  attempted: number;
  failed: number;
  lastFailure: string | null;
  warnings: string[];
}

const requestTally = new AsyncLocalStorage<SourceRequestTally>();

/** Fixed, credential-free adapter diagnostics for partial response/row failures. */
export function recordSourceWarning(warning: string): void {
  requestTally.getStore()?.warnings.push(warning);
}

function recordRequest(failure: string | null): void {
  const tally = requestTally.getStore();
  if (!tally) return;
  tally.attempted++;
  if (failure) {
    tally.failed++;
    tally.lastFailure = failure;
  }
}

// A fixed label, never the error message: some request URLs carry API keys
// (see FetchLogOptions.logUrl) and this text is stored on the source result.
function requestErrorLabel(error: unknown): string {
  return error instanceof Error && error.name === "TimeoutError" ? "timed out" : "network error";
}

/**
 * Runs one adapter's fetch and throws when every request it made failed, so
 * the scrape engine records the source as failed instead of as an empty
 * success. A source that made no requests (unconfigured) or got at least one
 * answer passes its jobs through unchanged.
 */
export async function fetchSourceJobs(
  fetchJobs: () => Promise<NormalizedJob[]>,
  onWarning?: (warning: string) => void,
): Promise<NormalizedJob[]> {
  const tally: SourceRequestTally = { attempted: 0, failed: 0, lastFailure: null, warnings: [] };
  const jobs = await requestTally.run(tally, fetchJobs);
  if (tally.attempted > 0 && tally.failed === tally.attempted) {
    throw new Error(`every request failed (last: ${tally.lastFailure})`);
  }
  if (tally.failed) tally.warnings.push(`${tally.failed} of ${tally.attempted} requests failed.`);
  if (tally.warnings.length) onWarning?.(`Partial results: ${[...new Set(tally.warnings)].join(" ")}`);
  return jobs;
}

const QUERY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const SHORT_QUERY_TOKENS = new Set(["ai", "bi", "c", "go", "hr", "it", "ml", "qa", "ui", "ux"]);

interface FetchLogOptions {
  /**
   * Credential-free stand-in for the real URL in failure logs. Pass one when
   * the URL embeds a secret (e.g. CareerOneStop request paths embed
   * COS_USER_ID — see careeronestop-config.ts's never-log contract).
   * Defaults to the real URL.
   */
  logUrl?: string;
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  options: FetchLogOptions = {},
): Promise<T | null> {
  const logUrl = options.logUrl ?? url;
  try {
    const headers = new Headers(init.headers);
    if (!headers.has("user-agent")) {
      headers.set("user-agent", JOB_SCOUT_USER_AGENT);
    }
    const response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      logger.warn("Job source request failed", { url: logUrl, status: response.status });
      recordRequest(`HTTP ${response.status}`);
      return null;
    }
    const body = (await response.json()) as T;
    recordRequest(null);
    return body;
  } catch (error) {
    logger.warn("Job source request errored", { url: logUrl, error: errorForLog(error) });
    recordRequest(requestErrorLabel(error));
    return null;
  }
}

export async function fetchText(url: string, init: RequestInit = {}): Promise<string | null> {
  try {
    const headers = new Headers(init.headers);
    if (!headers.has("user-agent")) {
      headers.set("user-agent", JOB_SCOUT_USER_AGENT);
    }
    const response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      logger.warn("Job source request failed", { url, status: response.status });
      recordRequest(`HTTP ${response.status}`);
      return null;
    }
    const text = await response.text();
    recordRequest(null);
    return text;
  } catch (error) {
    logger.warn("Job source request errored", { url, error: errorForLog(error) });
    recordRequest(requestErrorLabel(error));
    return null;
  }
}

export function queryTokens(query: string): string[] {
  const seen = new Set<string>();
  return (query.toLowerCase().match(/[a-z0-9+#.]+/g) ?? [])
    .filter((token) => {
      if (QUERY_STOPWORDS.has(token)) return false;
      return token.length >= 3 || SHORT_QUERY_TOKENS.has(token);
    })
    .filter((token) => {
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

export function textMatchesQuery(query: string, ...texts: Array<string | null | undefined>): boolean {
  const normalizedQuery = query.toLowerCase().trim().replace(/\s+/g, " ");
  if (!normalizedQuery) return true;

  const haystack = texts.join(" ").toLowerCase();
  if (haystack.includes(normalizedQuery)) return true;

  const tokens = queryTokens(normalizedQuery);
  if (tokens.length === 0) return true;

  const matched = tokens.filter((token) => haystack.includes(token)).length;
  return matched >= (tokens.length <= 2 ? 1 : 2);
}

export function stripHtml(value: string | null | undefined): string {
  return decodeHtmlEntities((value ?? "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function truncateDescription(value: string): string {
  return value.slice(0, 5000);
}

export function annualSalaryText(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min == null && max == null) return null;
  const low = min ?? max;
  const high = max ?? min;
  if (low == null || high == null) return null;
  if (low !== high) return `$${Math.round(low)}-$${Math.round(high)}/year`;
  return `$${Math.round(low)}/year`;
}

/**
 * Maps raw source items to NormalizedJob one at a time, isolating one
 * malformed item's failure from the rest of the batch — this is strictly
 * better than either extreme: the old bare-try/catch adapters swallowed
 * EVERY item silently on any single failure (one bad row hid a whole
 * successful response), and a plain `.map()` lets one thrown error fail the
 * entire fetchJobs() call (a stalled/500 batch turns into a total outage
 * instead of a partial one). Here, one bad item is skipped and logged; every
 * well-formed item still comes back.
 *
 * `mapItem` returning `null` means "skip, nothing wrong" (e.g. a genuinely
 * absent required field) and is never logged — only a THROWN error is
 * logged, since that's the unexpected case. The log carries only
 * `{ source, index }`, never the item payload (may hold job-posting free
 * text) or the thrown error's message (could echo back malformed input,
 * and in principle a URL with embedded secrets).
 */
export function mapEachJob<T>(
  items: readonly T[],
  source: string,
  mapItem: (item: T, index: number) => NormalizedJob | null,
): NormalizedJob[] {
  const out: NormalizedJob[] = [];
  items.forEach((item, index) => {
    try {
      const mapped = mapItem(item, index);
      if (mapped) out.push(mapped);
    } catch {
      logger.warn("Job source item failed to normalize", { source, index });
    }
  });
  return out;
}

export function xmlTag(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return "";
  return decodeHtmlEntities(match[1] ?? "").trim();
}
