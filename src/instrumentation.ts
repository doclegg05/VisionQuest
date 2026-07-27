import * as Sentry from "@sentry/nextjs";
import { validateRuntimeEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

// VQ-R-024: surface nested React Server Component request errors to Sentry —
// part of the same instrumentation-file convention that restored the client
// init (src/instrumentation-client.ts).
export const onRequestError = Sentry.captureRequestError;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      validateRuntimeEnv();
    } catch (error) {
      logger.error("Runtime environment validation failed", { error: String(error) });
      throw error;
    }
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
