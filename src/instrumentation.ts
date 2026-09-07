import { runBootProbes } from "@/lib/boot-probes";
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

    // After validateRuntimeEnv, which answers "is the configuration well
    // formed"; these answer "are the silent security controls actually on"
    // (src/lib/boot-probes.ts). In production a failure throws from here and
    // the boot stops, which is the point: an instance that enforces nothing
    // while looking healthy is worse than one that will not start.
    await runBootProbes();

    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
