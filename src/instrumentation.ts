import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";
import { markAppServer } from "@/lib/ai/app-server";
import { lockEvalEmbeddingOverride } from "@/lib/ai/eval-embedding-override-key";
import { runBootProbes } from "@/lib/boot-probes";
import { validateRuntimeEnv } from "@/lib/env";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import { withheldServerEvent } from "@/lib/sentry-scrub";

/** Long enough to send one event before a failed boot exits. */
const BOOT_FAILURE_FLUSH_MS = 2_000;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // First, before anything can load eval-only code: from here on the
    // OpenRouter providers refuse to run in this process, and the eval
    // embedding override cannot be installed. Real student data never
    // reaches OpenRouter (docs/runbooks/openrouter-test-bench.md).
    markAppServer();
    lockEvalEmbeddingOverride();

    // Before the probes, so that an alarm they raise has a client to send
    // it (H1, 2026-11-10). The config initialises nothing without SENTRY_DSN.
    await import("../sentry.server.config");

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
    await runBootProbes().catch(reportBootFailure);

    if (process.env.VQ_MAC_RELAY_ENABLED === "true" && process.env.NEXT_PHASE !== "phase-production-build") {
      const { startMemoryWorker } = await import("@/lib/sage/memory/jobs");
      startMemoryWorker();
      const { startMacWarmup } = await import("@/lib/sage/mac-warmup");
      startMacWarmup();
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/**
 * In production a failed boot probe throws rather than logging
 * boot_probe_failed (src/lib/boot-probes.ts), so the logger's alarm hook
 * never sees it. Report the throw here and flush before rethrowing, since
 * the process is about to stop. The message names the failed controls and
 * their configuration, not anyone's data.
 */
async function reportBootFailure(error: unknown): Promise<never> {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error, { tags: { alert: "boot_probe_failed" } });
    await Sentry.flush(BOOT_FAILURE_FLUSH_MS);
  }
  throw error;
}

/**
 * Errors Next catches itself: server component renders, route handlers not
 * wrapped by withErrorHandler, server actions and the proxy (H1,
 * 2026-11-10). The SDK's capture gets the route PATTERN Next supplies
 * (`/teacher/students/[id]`) as its path and no headers, because the real
 * path carries record ids and its query string, and the headers carry the
 * cookie and a referer with the same ids. `withheldServerEvent` then drops
 * the request, the breadcrumbs and the exception message, and scrubPii
 * still runs as beforeSend.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  if (!process.env.SENTRY_DSN) return;
  const meta = {
    route: context.routePath,
    method: request.method,
    errorCode: errorForLog(error).code,
  };
  Sentry.withScope((scope) => {
    scope.addEventProcessor(withheldServerEvent(meta));
    Sentry.captureRequestError(error, { path: context.routePath, method: request.method, headers: {} }, context);
  });
};
