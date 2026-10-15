/**
 * Shared runner for the three benchmarks that promote a
 * scripts/sage-chat-harness.mjs family (grounding, career, readability) to a
 * gated/nightly numeric metric. Spawns the harness UNMODIFIED via
 * lib/run-cli.mjs and reads its `byFamily[<family>]` bucket, which the
 * harness already computes (see its `report.byFamily` construction).
 *
 * The harness calls production's model through OpenRouter (2026-10-15; the
 * repo's GEMINI_API_KEY secret was rejected by Google). Every prompt is the
 * synthetic fixture config/sage-chat-eval.json: OpenRouter never sees real
 * student data (docs/runbooks/openrouter-test-bench.md). OpenRouter cannot
 * pass production's Gemini safetySettings, so a reply here is the model on
 * OpenRouter's defaults.
 */

import { runScriptForJsonReport } from "./run-cli.mjs";

export const CHAT_HARNESS_PROVIDER = "openrouter";

/**
 * Production's model (DEFAULT_GEMINI_MODEL in src/lib/gemini.ts) as OpenRouter
 * names it. Passed as --model so an OPENROUTER_MODEL in the environment cannot
 * change what the nightly measures.
 */
export const CHAT_HARNESS_MODEL = "google/gemini-3.1-flash-lite";

/**
 * Stands in for BENCH_PROD_READONLY_URL in the harness's environment. The
 * harness never reads that variable, and --provider=openrouter refuses to start
 * next to a non-local database URL. Non-empty, because the harness's
 * loadEnvFile fills empty variables from .env.local.
 */
const LOOPBACK_DATABASE_URL = "postgresql://none@127.0.0.1:1/none";

/** @param {string} family */
export function chatHarnessArgs(family) {
  return [`--families=${family}`, `--provider=${CHAT_HARNESS_PROVIDER}`, `--model=${CHAT_HARNESS_MODEL}`];
}

/**
 * The environment overlay for the harness process: the OpenRouter key, and an
 * empty Google key even when the job holds one for other suites. In CI, which
 * has no .env.local to refill it, nothing in the run can call Google directly.
 *
 * @param {object} opts
 * @param {string} [opts.openrouterApiKey]
 * @param {NodeJS.ProcessEnv} [opts.env] - extra variables for this family
 */
export function chatHarnessEnv({ openrouterApiKey, env = {} }) {
  if (!openrouterApiKey) {
    throw new Error("The chat harness suites require OPENROUTER_API_KEY.");
  }
  return {
    ...env,
    OPENROUTER_API_KEY: openrouterApiKey,
    GEMINI_API_KEY: "",
    BENCH_PROD_READONLY_URL: LOOPBACK_DATABASE_URL,
  };
}

/**
 * @param {string} family - "grounding" | "career" | "readability"
 * @param {object} opts
 * @param {string} opts.openrouterApiKey
 * @param {NodeJS.ProcessEnv} [opts.env]
 */
export async function runChatHarnessFamily(family, opts) {
  const report = await runScriptForJsonReport("scripts/sage-chat-harness.mjs", chatHarnessArgs(family), {
    env: chatHarnessEnv(opts),
    timeoutMs: 300_000,
  });

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
