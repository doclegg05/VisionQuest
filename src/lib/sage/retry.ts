import { logger } from "@/lib/logger";

interface RetryOptions {
  /** Human-readable label for log lines, e.g. "Mood extraction". */
  label: string;
  /**
   * Logged as `alert: <alertKey>` when every attempt fails, so monitoring can
   * page on silent value-loop gaps (mirrors goal-extractor's
   * `goal_extraction_exhausted`).
   */
  alertKey: string;
  /** Total attempts including the first. Defaults to 3. */
  maxAttempts?: number;
  /** Extra structured context merged into every log line (ids, etc.). */
  context?: Record<string, unknown>;
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
  { label, alertKey, maxAttempts = 3, context = {} }: RetryOptions,
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

  // All retries exhausted. TODO: persist to a failure table for instructor
  // review (matches the goal-extractor TODO; needs a schema migration).
  logger.error(`${label} failed after retries`, {
    attempts: maxAttempts,
    ...context,
    error: String(lastError),
    alert: alertKey,
  });
  throw lastError;
}
