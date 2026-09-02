import { logger } from "./logger";

/**
 * VISIONQUEST_DISABLE_RATE_LIMITS=true switches off the chat hourly and daily
 * caps (src/app/api/chat/send/route.ts) and the crisis-record cap
 * (src/lib/chat/crisis-scan.ts). It is a development convenience for driving
 * one account far past human chat pace against a local model, which is how
 * the 2026-04-07 RAG ingestion spec introduced it (it also called for a
 * warning that was never built).
 *
 * Production ignores it: the caps are the only host protection for the local
 * Ollama box and the only Gemini spend cap, so a test value copied into the
 * Render dashboard must not remove them (review F19 / SEC-07, 2026-09-01).
 * The first ignored read logs one warning so the stray variable is visible.
 *
 * This is the only reader of the variable. Call sites use this predicate
 * rather than reading process.env themselves.
 */
export function rateLimitsDisabled(): boolean {
  if (process.env.VISIONQUEST_DISABLE_RATE_LIMITS !== "true") return false;
  if (process.env.NODE_ENV !== "production") return true;
  warnIgnoredOnce();
  return false;
}

/** Once per process: the variable is static, so repeating the line is noise. */
let warnedIgnoredInProduction = false;

function warnIgnoredOnce(): void {
  if (warnedIgnoredInProduction) return;
  warnedIgnoredInProduction = true;
  logger.warn(
    "VISIONQUEST_DISABLE_RATE_LIMITS=true is ignored in production; chat and crisis rate limits stay on",
  );
}
