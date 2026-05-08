/**
 * Client-side logger that routes errors and warnings to Sentry while keeping
 * developer console visibility.
 *
 * Why this exists:
 *   Lint rule `no-console` is being enabled at warn level for client components
 *   (src/components/**, route pages/layouts) so error reporting is centralized.
 *   Use `clientLogger.error(err, ctx)` in catch blocks and
 *   `clientLogger.warn(message, ctx)` for non-fatal warnings.
 *
 * Safe to import from both client and server code — the @sentry/nextjs SDK
 * provides matching APIs on both runtimes.
 */
import * as Sentry from "@sentry/nextjs";

type LogContext = Record<string, unknown>;

function logError(error: unknown, context?: LogContext): void {
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Sentry must never break user-facing flows — swallow capture errors.
  }
  // Preserve dev console visibility. The no-console lint rule excludes this file
  // (it lives in src/lib/, not src/components/).
  if (context) {
    console.error(error, context);
  } else {
    console.error(error);
  }
}

function logWarn(message: string, context?: LogContext): void {
  try {
    Sentry.captureMessage(message, {
      level: "warning",
      ...(context ? { extra: context } : {}),
    });
  } catch {
    // Same rationale as logError: never let telemetry break the page.
  }
  if (context) {
    console.warn(message, context);
  } else {
    console.warn(message);
  }
}

export const clientLogger = {
  error: logError,
  warn: logWarn,
};
