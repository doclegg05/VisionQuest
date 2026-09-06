/**
 * Shared runner for the three benchmarks that promote a
 * scripts/sage-chat-harness.mjs family (grounding, career, readability) to a
 * gated/nightly numeric metric. Spawns the harness UNMODIFIED via
 * lib/run-cli.mjs and reads its `byFamily[<family>]` bucket, which the
 * harness already computes (see its `report.byFamily` construction).
 */

import { runScriptForJsonReport } from "./run-cli.mjs";

/**
 * @param {string} family - "grounding" | "career" | "readability"
 * @param {object} [opts]
 * @param {string} [opts.geminiApiKey]
 */
export async function runChatHarnessFamily(family, opts = {}) {
  const env = {};
  if (opts.geminiApiKey) env.GEMINI_API_KEY = opts.geminiApiKey;

  const report = await runScriptForJsonReport(
    "scripts/sage-chat-harness.mjs",
    [`--families=${family}`, "--provider=gemini"],
    { env, timeoutMs: 300_000 },
  );

  const bucket = report.byFamily?.[family] ?? { total: 0, passed: 0, failed: 0, skipped: 0 };
  const caseResults = (report.results ?? []).filter((r) => r.family === family);

  return { report, bucket, caseResults };
}

/** Pure pass-rate computation over an already-fetched byFamily bucket. */
export function passRateFromBucket(bucket) {
  const evaluated = bucket.total - bucket.skipped;
  return {
    evaluated,
    passRate: evaluated > 0 ? bucket.passed / evaluated : null,
  };
}
