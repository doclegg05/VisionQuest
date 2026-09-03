import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { rateLimited, withErrorHandler } from "@/lib/api-error";
import { rateLimit } from "@/lib/rate-limit";

/**
 * CSP violation reporting endpoint.
 * Browsers POST violation reports here when Content-Security-Policy is violated.
 *
 * Unauthenticated by nature, so the body is hostile input (review F19 /
 * SEC-09, 2026-09-01): per-IP rate limit, a hard body cap, and a log line made
 * of three derived, truncated fields. The raw report is never logged; a
 * document-uri can carry /reset-password?token=... and a blocked-uri can carry
 * anything the sender chooses.
 */

/** Real reports are well under 2 KB; the cap only bounds a flood. */
const MAX_BODY_BYTES = 16 * 1024;
/** Per client IP per minute. A page bursts a handful of violations at most. */
const REPORTS_PER_WINDOW = 30;
const WINDOW_MS = 60 * 1000;
/** Every logged field is cut to this length. */
const MAX_FIELD_LENGTH = 120;

/** Both spellings: CSP Level 2 `csp-report` keys and Reporting API camelCase. */
const reportFieldsSchema = z.object({
  "violated-directive": z.string().optional(),
  "effective-directive": z.string().optional(),
  effectiveDirective: z.string().optional(),
  "blocked-uri": z.string().optional(),
  blockedURL: z.string().optional(),
  "document-uri": z.string().optional(),
  documentURL: z.string().optional(),
});

/** First forwarded hop, the same key the auth routes limit on. */
function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Read at most `maxBytes`; null when the body is larger. */
async function readBodyCapped(req: NextRequest, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const reader = req.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Unwrap the two wire shapes to the field object: `{ "csp-report": {...} }`
 * (CSP Level 2) or `[{ type: "csp-violation", body: {...} }]` (Reporting API).
 */
function unwrapReport(json: unknown): unknown {
  if (Array.isArray(json)) {
    const first: unknown = json[0];
    return first !== null && typeof first === "object" && "body" in first ? first.body : first;
  }
  if (json !== null && typeof json === "object" && "csp-report" in json) {
    return json["csp-report"];
  }
  return json;
}

function truncate(value: string): string {
  return value.length > MAX_FIELD_LENGTH ? value.slice(0, MAX_FIELD_LENGTH) : value;
}

/** Everything before a query string, fragment, or whitespace. */
function leadingToken(value: string): string {
  return truncate(value.split(/[?#\s]/)[0] ?? "");
}

/** Host of a URL; a CSP keyword such as `inline` or `eval` stays as the bare token. */
function hostOf(uri: string): string {
  try {
    const url = new URL(uri);
    return truncate(url.hostname || url.protocol);
  } catch {
    return leadingToken(uri);
  }
}

/** Path of a URL: no query string, no fragment. */
function pathOf(uri: string): string {
  try {
    return truncate(new URL(uri).pathname);
  } catch {
    return leadingToken(uri);
  }
}

const ACCEPTED = () => new NextResponse(null, { status: 204 });

export const POST = withErrorHandler(async (req: NextRequest) => {
  const limit = await rateLimit(`csp-report:${clientIp(req)}`, REPORTS_PER_WINDOW, WINDOW_MS);
  if (!limit.success) throw rateLimited();

  const text = await readBodyCapped(req, MAX_BODY_BYTES);
  if (text === null) {
    return NextResponse.json({ error: "Report too large" }, { status: 413 });
  }

  // Not parseBody: the capped read above already consumed the stream, and a
  // malformed report is dropped silently rather than answered with 400.
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return ACCEPTED();
  }
  const parsed = reportFieldsSchema.safeParse(unwrapReport(json));
  if (!parsed.success) return ACCEPTED();

  const report = parsed.data;
  const violatedDirective =
    report["violated-directive"] ?? report["effective-directive"] ?? report.effectiveDirective;
  if (!violatedDirective) return ACCEPTED();

  logger.warn("CSP violation", {
    violatedDirective: truncate(violatedDirective),
    blockedHost: hostOf(report["blocked-uri"] ?? report.blockedURL ?? ""),
    documentPath: pathOf(report["document-uri"] ?? report.documentURL ?? ""),
  });

  return ACCEPTED();
});
