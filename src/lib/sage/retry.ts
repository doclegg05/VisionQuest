import { logger } from "@/lib/logger";
import { recordFailedExtraction } from "./failed-extraction";

interface RetryOptions {
  /** Human-readable label for log lines, e.g. "Mood extraction". */
  label: string;
  /**
   * Logged as `alert: <alertKey>` when every attempt fails, so monitoring can
   * page on silent value-loop gaps (mirrors goal-extractor's
   * `goal_extraction_exhausted`). Doubles as the FailedExtraction.extractorKey
   * when the exhausted failure is dead-lettered.
   */
  alertKey: string;
  /** Total attempts including the first. Defaults to 3. */
  maxAttempts?: number;
  /** Extra structured context merged into every log line (ids, etc.). */
  context?: Record<string, unknown>;
  /**
   * When set, an exhausted failure is dead-lettered to the FailedExtraction
   * table (see src/lib/sage/failed-extraction.ts) for staff review. Call
   * sites without a studentId in scope simply omit it — persistence is
   * skipped and behavior is unchanged.
   */
  studentId?: string;
  conversationId?: string;
  /**
   * Lazily builds the input snapshot persisted alongside the failure
   * (capped at 8000 chars by recordFailedExtraction). Only invoked on
   * exhaustion, and only when `studentId` is set.
   */
  failurePayload?: () => string;
}

/** A throwing payload builder must not mask the original extractor error. */
function buildPayloadSafely(failurePayload?: () => string): string {
  if (!failurePayload) return "";
  try {
    return failurePayload();
  } catch (error: unknown) {
    return `payload unavailable: ${String(error)}`;
  }
}

/**
 * Run an async function with exponential backoff. This is the shared B3
 * value-loop pattern: post-response extractors (goals, mood, classroom,
 * discovery) make transient AI calls whose failures used to vanish into a
 * `.catch()` log, leaving silent gaps in grant-relevant data. Retrying buys
 * resilience against timeouts/rate-limits/malformed JSON, and a final failure
 * is logged loudly with an `alert:` key.
 *
 * The last error is re-thrown so callers keep their own "never bubble"
 * contract (each extractor already swallows at its boundary) — the value added
 * here is the retry and the loud alert, not a behavior change for the caller.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  { label, alertKey, maxAttempts = 3, context = {}, studentId, conversationId, failurePayload }: RetryOptions,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      logger.warn(`${label} attempt failed`, {
        attempt,
        maxAttempts,
        ...context,
        error: String(error),
      });
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      }
    }
  }

  // All retries exhausted. Dead-letter the failure for staff review via
  // recordFailedExtraction (src/lib/sage/failed-extraction.ts) when the call
  // site gave us a studentId; it never throws, so the caller's "never
  // bubble" contract is preserved either way.
  if (studentId) {
    await recordFailedExtraction({
      studentId,
      conversationId,
      extractorKey: alertKey,
      payload: buildPayloadSafely(failurePayload),
      error: String(lastError),
      attempts: maxAttempts,
    });
  }
  logger.error(`${label} failed after retries`, {
    attempts: maxAttempts,
    ...context,
    error: String(lastError),
    alert: alertKey,
  });
  throw lastError;
}
