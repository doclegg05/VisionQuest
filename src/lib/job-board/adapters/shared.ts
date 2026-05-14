import { logger } from "@/lib/logger";

export const JOB_SCOUT_USER_AGENT = "VisionQuest Job Scout/0.1";

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

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T | null> {
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
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    logger.warn("Job source request errored", { url, error: String(error) });
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
      return null;
    }
    return response.text();
  } catch (error) {
    logger.warn("Job source request errored", { url, error: String(error) });
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

export function xmlTag(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) return "";
  return decodeHtmlEntities(match[1] ?? "").trim();
}
