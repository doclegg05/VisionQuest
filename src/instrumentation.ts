import { validateRuntimeEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

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
