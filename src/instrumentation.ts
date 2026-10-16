import { markAppServer } from "@/lib/ai/app-server";
import { lockEvalEmbeddingOverride } from "@/lib/ai/eval-embedding-override-key";
import { runBootProbes } from "@/lib/boot-probes";
import { validateRuntimeEnv } from "@/lib/env";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // First, before anything can load eval-only code: from here on the
    // OpenRouter providers refuse to run in this process, and the eval
    // embedding override cannot be installed. Real student data never
    // reaches OpenRouter (docs/runbooks/openrouter-test-bench.md).
    markAppServer();
    lockEvalEmbeddingOverride();

    try {
      validateRuntimeEnv();
    } catch (error) {
      logger.error("Runtime environment validation failed", { error: errorForLog(error) });
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
