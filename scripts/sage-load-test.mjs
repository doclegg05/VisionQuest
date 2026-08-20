#!/usr/bin/env node
/**
 * Sage classroom concurrency instrument (scripts/sage-load-test.mjs).
 *
 * WHY THIS EXISTS
 * ----------------
 * Every student_record / staff_entered chat turn is FERPA-routed to ONE local
 * Ollama endpoint behind a Cloudflare tunnel (`resolveAiProvider` in
 * src/lib/ai/provider.ts — see isLocalOnlySensitivity). Ollama serves
 * requests SERIALLY by default: nothing in this repo sets
 * OLLAMA_NUM_PARALLEL (grep confirms zero hits outside this file and
 * docs/superpowers/specs/2026-04-04-local-ai-migration-design.md, which
 * *planned* `OLLAMA_NUM_PARALLEL=4` for the Mac Studio ops setup but that
 * setting was never carried into any config this repo ships or documents as
 * applied). Measured single-call latency on the target model is ~20-21s per
 * reply. A class of 15 students sending one message each around the same
 * time therefore does not mean "15 replies in ~21s" — it means something
 * close to 15 x 21s ~= 5+ minutes for the last student, indistinguishable
 * from an outage from that student's chair. No load test or queue/backpressure
 * design existed before this script.
 *
 * WHAT THIS SCRIPT DOES
 * ----------------------
 * Drives N concurrent `generateResponse` calls through the REAL
 * `OllamaProvider` class (src/lib/ai/ollama-provider.ts), constructed the
 * same way `getLocalProvider()` in src/lib/ai/provider.ts builds it for
 * production (same auth-config shape as scripts/lib/sage-eval-provider.mjs's
 * `resolveOllamaProvider`, which every other Sage eval script already uses to
 * get a real provider instance from a .mjs script via tsx — no new loader
 * invented). Each simulated "client" gets a FRESH `OllamaProvider` instance
 * per turn, because that is what production does: `resolveAiProvider()` is
 * called anew on every /api/chat/send request, so `apiMode` is never warm
 * across turns in production and this instrument must not warm it either.
 *
 * The system prompt sent on every call is SYNTHETIC — clearly marked, holds
 * no real program content and no student data — but sized to match the real
 * Sage system prompt (~20k chars per `docs/plans/2026-08-19-what-better-means-charter.md`
 * and this session's verified context), because prompt-eval time scales with
 * input size and a short synthetic prompt would understate real latency.
 *
 * Errors are DATA, not crashes. `OllamaProvider.generateResponse` recently
 * (commit e3bd2ef) started throwing loudly instead of returning "" for a
 * truncated/tool-call/unknown-cause empty completion, and separately can
 * reject with a stream/timeout error. This script catches per-request,
 * classifies by message shape, and keeps going — a queue pileup SHOULD
 * produce failures under this instrument, and swallowing them or dying on
 * the first one would hide the exact signal we're here to measure.
 *
 * USAGE
 * -----
 *   npx tsx scripts/sage-load-test.mjs --concurrency=3
 *   npx tsx scripts/sage-load-test.mjs --concurrency=15 --turns=1 --classroom-size=15
 *   npx tsx scripts/sage-load-test.mjs --concurrency=2 --max-output-tokens=150   # quick smoke
 *
 * Flags (all optional):
 *   --concurrency=<n>          number of simulated students hitting send at once (default 1)
 *   --turns=<n>                messages per simulated student, sent sequentially (default 1)
 *   --model=<name>             Ollama model tag (default: env OLLAMA_MODEL, else "gemma4:latest" —
 *                              the model this session verified resident; NOT the same as
 *                              DEFAULT_OLLAMA_MODEL in src/lib/ai/local-config.ts, which names a
 *                              different larger tag used only as provider.ts's own fallback)
 *   --url=<base>               Ollama base URL (default: env OLLAMA_URL, else http://localhost:11434)
 *   --max-output-tokens=<n>    caps reply length via LocalAIAuthConfig.maxOutputTokens, same knob
 *                              production exposes as ai_provider_max_output_tokens /
 *                              AI_PROVIDER_MAX_OUTPUT_TOKENS (default: env AI_PROVIDER_MAX_OUTPUT_TOKENS,
 *                              else OllamaProvider's own default of 768)
 *   --prompt-chars=<n>         synthetic system-prompt length in characters (default 20000)
 *   --classroom-size=<n>       N for the "Nth student" projection in the verdict (default 15)
 *   --json-out=<path>          optionally write the full per-request result array as JSON
 *
 * THE FULL 15-WAY PROCEDURE (do not run casually — this pins the shared Mac's
 * only local model for several minutes and starves every other agent's calls)
 * -----------------------------------------------------------------------------
 *   1. Confirm the box is quiet: `curl -s localhost:11434/api/ps` should show
 *      at most the target model resident, and check with whoever owns other
 *      active sessions before pinning it for ~5+ minutes.
 *   2. Do NOT evict the resident model and do NOT touch KEEP_ALIVE — this
 *      script (like production) sends `keep_alive: "8h"` on every call via
 *      OllamaProvider itself; that is intentional in production and this
 *      instrument must not fight it.
 *   3. Run: `npx tsx scripts/sage-load-test.mjs --concurrency=15 --turns=1
 *      --classroom-size=15 --json-out=/tmp/sage-load-15way.json`
 *      Use production's real default (no --max-output-tokens override) so the
 *      run reflects an actual reply length, not a smoke-shortened one.
 *   4. Read the CLASSROOM VERDICT block. Compare the projected Nth-student
 *      wait against `OllamaProvider.GENERATE_TIMEOUT_MS` (300s, defined at
 *      src/lib/ai/ollama-provider.ts:411, mirrored below as
 *      NON_STREAMING_TIMEOUT_MS) — if the projection is at or past that line,
 *      the tail students in a real classroom will see their request
 *      *time out and error*, not just arrive slowly.
 *   5. Re-run once more after a few minutes if the first run's p50/p95 spread
 *      looks noisy (CPU thermal throttling and background OS work both move
 *      this number on a single Mac).
 *
 * THE TWO LEVERS TO EVALUATE IF THE VERDICT IS BAD (analysis pointers only —
 * no implementation here; this script's job is measurement, not the fix)
 * -----------------------------------------------------------------------------
 *   A. OLLAMA_NUM_PARALLEL (server-side): lets Ollama interleave multiple
 *      requests on one loaded model instead of a strict FIFO queue. This was
 *      part of the ORIGINAL plan (`OLLAMA_NUM_PARALLEL=4`, see
 *      docs/superpowers/specs/2026-04-04-local-ai-migration-design.md line
 *      ~199) but is not configured anywhere this repo controls today — it is
 *      a launchd/environment setting on the Mac Studio host, not app code.
 *      Cost: each parallel slot duplicates KV-cache VRAM for the model's full
 *      context window (`num_ctx`, currently OllamaProvider.DEFAULT_NUM_CTX =
 *      8192 unless overridden by ai_provider_num_ctx) — measure free VRAM
 *      headroom on the actual host before raising this, since an
 *      over-committed value degrades EVERY concurrent request instead of
 *      queueing some of them cleanly.
 *   B. Queue-with-feedback UX (client-side): if the server-side lever can't
 *      close the gap alone, the student-facing failure mode can still change
 *      from "silence for 5 minutes" to "you're #7 in line, ~2 min left" —
 *      requires a request queue with position tracking in front of
 *      /api/chat/send and a UI affordance to render it. Not designed here.
 *
 * NOT MEASURED HERE: this instrument calls `generateResponse` (non-streaming),
 * matching how scripts/sage-quality-eval.mjs already drives OllamaProvider,
 * because that is the simplest apples-to-apples signal for "how long until a
 * full reply exists". Production's live chat path streams
 * (`streamResponse`/`streamWithTools`) over SSE, so a student's UI shows
 * *something* moving sooner than this script's numbers suggest — but total
 * time-to-full-reply is governed by the same serial Ollama queue either way,
 * so the queueing conclusion below holds regardless of which call production
 * uses.
 */

import { loadEnvFile } from "./lib/sage-rag-utils.mjs";
import { percentile } from "./lib/percentile.mjs";
import { writeFileSync } from "node:fs";

loadEnvFile();

/**
 * Mirror of OllamaProvider.GENERATE_TIMEOUT_MS (src/lib/ai/ollama-provider.ts:411).
 * Not imported directly — it's a private static field on the class. Kept as
 * a named, cited constant instead of a bare magic number so a future reader
 * can verify it hasn't drifted, and so the CLASSROOM VERDICT's timeout
 * comparison has a source of truth.
 */
const NON_STREAMING_TIMEOUT_MS = 300_000;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const get = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const getInt = (name, fallback) => {
    const raw = get(name, null);
    if (raw === null) return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) {
      throw new Error(`--${name} must be an integer, got "${raw}"`);
    }
    return n;
  };

  const concurrency = getInt("concurrency", 1);
  const turns = getInt("turns", 1);
  const maxOutputTokens = getInt("max-output-tokens", Number.parseInt(process.env.AI_PROVIDER_MAX_OUTPUT_TOKENS ?? "", 10) || 768);
  const promptChars = getInt("prompt-chars", 20_000);
  const classroomSize = getInt("classroom-size", 15);
  const model = get("model", process.env.OLLAMA_MODEL || "gemma4:latest");
  const url = get("url", process.env.OLLAMA_URL || "http://localhost:11434");
  const jsonOut = get("json-out", null);

  if (concurrency < 1) throw new Error("--concurrency must be >= 1");
  if (turns < 1) throw new Error("--turns must be >= 1");
  if (maxOutputTokens < 1) throw new Error("--max-output-tokens must be >= 1");
  if (promptChars < 1) throw new Error("--prompt-chars must be >= 1");
  if (classroomSize < 1) throw new Error("--classroom-size must be >= 1");

  return { concurrency, turns, maxOutputTokens, promptChars, classroomSize, model, url, jsonOut };
}

// ---------------------------------------------------------------------------
// Synthetic prompt / message generation — NO real Sage prompt text, NO
// student data. Sized to match the real prompt's character count so
// prompt-eval latency in the measurement is representative.
// ---------------------------------------------------------------------------

const SYNTHETIC_SECTIONS = [
  "ROLE (SYNTHETIC): You are a placeholder coaching assistant used only for local load testing. You are not a real program advisor and this text is not the real Sage prompt.",
  "TONE (SYNTHETIC): Warm, brief, plain language. This paragraph exists purely to occupy space at a realistic character count for prompt-evaluation timing.",
  "GUARDRAILS (SYNTHETIC): Do not give medical, legal, or financial advice. This is filler text repeated to reach a target prompt length; it carries no program policy.",
  "PROGRAM CATALOG REFERENCE (SYNTHETIC): Item A, Item B, Item C — placeholder catalog entries with no correspondence to any real certification, course, or document in this system.",
  "TOOL AVAILABILITY (SYNTHETIC): No tools are declared in this load test. Any mention of a tool name here is fictional and used only to mirror the shape (not content) of the production prompt.",
  "CONVERSATION STYLE (SYNTHETIC): Reflect before advising. Ask at most one question. Keep replies short. Restated here only to pad the synthetic prompt to a realistic size.",
];

/**
 * Builds a synthetic system prompt of ~targetChars length, unique per client.
 *
 * MUST vary per client, not just be padded filler. The real Sage prompt
 * personalizes early (student name, stage, RAG-retrieved context), so two
 * different students' prompts never share a full matching prefix. Ollama
 * reuses the previous request's KV cache when a new prompt shares its
 * prefix — verified directly in this session: an initial version of this
 * function returned the SAME prompt for every client, and the second
 * concurrent request came back in 1.3s against a 24.9s single-call cold
 * baseline, purely from prefix-cache reuse, not from any real concurrency
 * benefit. Embedding a per-client marker in the first line defeats that
 * cache the same way production's per-student personalization does, so the
 * measured numbers reflect the no-cache-benefit case a real classroom faces.
 */
function buildSyntheticSystemPrompt(targetChars, clientIndex) {
  const header =
    "=== SYNTHETIC LOAD-TEST PROMPT (scripts/sage-load-test.mjs) ===\n" +
    `SYNTHETIC STUDENT MARKER: student-${clientIndex}-${Date.now()} ` +
    "(present only to defeat Ollama's prompt-prefix cache across different " +
    "simulated students, the way a real student's name/RAG context does)\n" +
    "This is NOT the real Sage system prompt. It contains no real program\n" +
    "content and no student data. It exists only to give the classroom\n" +
    "concurrency instrument a prompt of realistic length for prompt-eval\n" +
    "timing purposes.\n\n";
  let out = header;
  let i = 0;
  while (out.length < targetChars) {
    out += `[section ${i}] ${SYNTHETIC_SECTIONS[i % SYNTHETIC_SECTIONS.length]}\n\n`;
    i++;
  }
  return out.slice(0, targetChars);
}

/** Synthetic per-turn user message. No student data. */
function syntheticUserMessage(clientIndex, turnIndex) {
  return (
    `[SYNTHETIC LOAD TEST] Simulated student ${clientIndex}, turn ${turnIndex}: ` +
    `Give me one short, encouraging sentence about staying on track with a weekly goal. ` +
    `Keep it under 40 words.`
  );
}

// ---------------------------------------------------------------------------
// Provider construction — mirrors src/lib/ai/provider.ts's getLocalProvider()
// / scripts/lib/sage-eval-provider.mjs's resolveOllamaProvider(): same
// OllamaProvider class, same LocalAIAuthConfig shape, same env-var names for
// auth. Extended only with maxOutputTokens so smoke runs can bound reply
// length without touching production defaults.
// ---------------------------------------------------------------------------

async function createOllamaProvider({ url, model, maxOutputTokens }) {
  const { OllamaProvider } = await import("../src/lib/ai/ollama-provider.ts");
  const { resolveLocalAiAuthMode } = await import("../src/lib/ai/local-auth.ts");

  const authMode = resolveLocalAiAuthMode(
    process.env.AI_PROVIDER_AUTH_MODE ?? process.env.OLLAMA_AUTH_MODE ?? null,
  );
  const authConfig = {
    authMode,
    apiKey: process.env.AI_PROVIDER_API_KEY || process.env.OLLAMA_API_KEY || null,
    cloudflareAccessClientId:
      process.env.AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_ID ||
      process.env.CF_ACCESS_CLIENT_ID ||
      process.env.CLOUDFLARE_ACCESS_CLIENT_ID ||
      null,
    cloudflareAccessClientSecret:
      process.env.AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_SECRET ||
      process.env.CF_ACCESS_CLIENT_SECRET ||
      process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET ||
      null,
    maxOutputTokens,
  };

  return new OllamaProvider(url, model, authConfig);
}

// ---------------------------------------------------------------------------
// Error classification — errors are DATA. Message-shape matching against the
// exact strings OllamaProvider throws (src/lib/ai/ollama-provider.ts).
// ---------------------------------------------------------------------------

function classifyError(err) {
  const message = err instanceof Error ? err.message : String(err);
  if (/hit its .* output budget without emitting any visible content/.test(message)) {
    return { kind: "output_budget_exhausted", message };
  }
  if (/ended its turn with a tool call.*no visible content/.test(message)) {
    return { kind: "tool_call_dropped", message };
  }
  if (/returned an empty reply and the turn ended normally/.test(message)) {
    return { kind: "empty_unknown_cause", message };
  }
  if (/Local AI request failed \(\d+\)/.test(message)) {
    return { kind: "http_error", message };
  }
  if (/aborted|timed out|timeout/i.test(message)) {
    return { kind: "timeout_or_abort", message };
  }
  return { kind: "other", message };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function runOneRequest({ args, systemPrompt, clientIndex, turnIndex, history, now }) {
  const queuedAtMs = now();
  const provider = await createOllamaProvider(args);
  const startedAtMs = now();
  try {
    const reply = await provider.generateResponse(systemPrompt, history);
    const completedAtMs = now();
    const durationMs = completedAtMs - startedAtMs;
    return {
      clientIndex,
      turnIndex,
      outcome: "ok",
      queuedAtMs,
      startedAtMs,
      completedAtMs,
      // Non-streaming call: there is no earlier content signal than full
      // completion, so TTFT-equivalent IS the total duration. Reported
      // explicitly (not omitted) so the schema stays stable if a future
      // revision switches to streamResponse for a true TTFT.
      startDelayMs: startedAtMs - queuedAtMs,
      ttftEquivalentMs: durationMs,
      durationMs,
      replyChars: reply.length,
      reply,
    };
  } catch (err) {
    const completedAtMs = now();
    const durationMs = completedAtMs - startedAtMs;
    return {
      clientIndex,
      turnIndex,
      outcome: "error",
      queuedAtMs,
      startedAtMs,
      completedAtMs,
      startDelayMs: startedAtMs - queuedAtMs,
      ttftEquivalentMs: durationMs,
      durationMs,
      error: classifyError(err),
    };
  }
}

async function runClient({ args, clientIndex, now }) {
  // Built once per client (not once per run) so concurrent clients never
  // share a cache-friendly identical prefix — see buildSyntheticSystemPrompt.
  const systemPrompt = buildSyntheticSystemPrompt(args.promptChars, clientIndex);
  const history = [];
  const results = [];
  for (let turnIndex = 1; turnIndex <= args.turns; turnIndex++) {
    history.push({ role: "user", content: syntheticUserMessage(clientIndex, turnIndex) });
    const result = await runOneRequest({
      args,
      systemPrompt,
      clientIndex,
      turnIndex,
      history: [...history],
      now,
    });
    results.push(result);
    if (result.outcome === "ok") {
      history.push({ role: "model", content: result.reply });
    }
    // On error, deliberately do NOT append a model turn and keep going —
    // this client's next turn still exercises the provider, and hiding
    // later turns behind an early failure would understate the load.
  }
  return results;
}

// ---------------------------------------------------------------------------
// Stats + report
// ---------------------------------------------------------------------------

function fmtMs(ms) {
  if (ms === null || ms === undefined) return "n/a";
  return `${Math.round(ms)}ms`;
}

function fmtSec(ms) {
  if (ms === null || ms === undefined) return "n/a";
  return `${(ms / 1000).toFixed(1)}s`;
}

function report(allResults, wallClockMs, args) {
  console.log("\n--- per-request results ---");
  for (const r of allResults) {
    if (r.outcome === "ok") {
      console.log(
        `  client=${r.clientIndex} turn=${r.turnIndex} OK   ` +
          `startDelay=${fmtMs(r.startDelayMs)} duration=${fmtMs(r.durationMs)} ` +
          `completedAt=${fmtMs(r.completedAtMs)} replyChars=${r.replyChars}`,
      );
    } else {
      console.log(
        `  client=${r.clientIndex} turn=${r.turnIndex} ERROR[${r.error.kind}] ` +
          `startDelay=${fmtMs(r.startDelayMs)} duration=${fmtMs(r.durationMs)} ` +
          `completedAt=${fmtMs(r.completedAtMs)} — ${r.error.message}`,
      );
    }
  }

  const ok = allResults.filter((r) => r.outcome === "ok");
  const failed = allResults.filter((r) => r.outcome === "error");
  const durations = ok.map((r) => r.durationMs).sort((a, b) => a - b);
  const sumDurationsMs = allResults.reduce((sum, r) => sum + r.durationMs, 0);
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  const max = durations.length ? durations[durations.length - 1] : null;
  const mean = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const throughputPerSec = ok.length > 0 ? ok.length / (wallClockMs / 1000) : 0;

  // Serialization check. A non-streaming call's client-observed "duration"
  // bundles queue-wait AND generation time together (the fetch just sits
  // open the whole time), so raw wall-clock/sum-of-durations does NOT
  // converge to 1.0 under full serialization — it converges to 2/(N+1) for N
  // equal-cost requests all submitted at once (derived and verified against
  // this script's own concurrency=2 run: predicted 2/3=0.667, measured
  // 0.667). Both numbers are reported since the ticket asked for this exact
  // comparison, but the "genuinely serialized?" verdict below uses a
  // sturdier proxy: the FIRST request to complete in a serial queue has ~0
  // wait, so its duration approximates the true per-call cost. If wall-clock
  // ~= concurrency x that minimum, every later request paid a full queue
  // wait — consistent with strict FIFO serialization. This proxy only holds
  // for --turns=1, where every client's one request is submitted at t~=0.
  const minDurationMs = durations.length ? durations[0] : null;
  const expectedRatioIfSerial = 2 / (args.concurrency + 1);
  const rawRatio = sumDurationsMs > 0 ? wallClockMs / sumDurationsMs : null;
  const predictedSerialWallClockMs =
    args.turns === 1 && minDurationMs !== null ? args.concurrency * minDurationMs : null;
  const serialFitRatio =
    predictedSerialWallClockMs !== null && predictedSerialWallClockMs > 0
      ? wallClockMs / predictedSerialWallClockMs
      : null;

  console.log("\n--- summary ---");
  console.log(`  requests: ${allResults.length} (ok=${ok.length}, error=${failed.length})`);
  console.log(`  wall-clock: ${fmtMs(wallClockMs)} (${fmtSec(wallClockMs)})`);
  console.log(`  sum of per-request durations: ${fmtMs(sumDurationsMs)} (${fmtSec(sumDurationsMs)})`);
  console.log(
    `  wall-clock / sum-of-durations: ${rawRatio === null ? "n/a" : rawRatio.toFixed(3)}` +
      ` (expected ~${expectedRatioIfSerial.toFixed(3)} if fully serial at concurrency=${args.concurrency}` +
      ` — this ratio depends on N, it is NOT expected to be ~1.0; see code comment)`,
  );
  if (serialFitRatio !== null) {
    console.log(
      `  wall-clock / (concurrency x min-duration): ${serialFitRatio.toFixed(3)} — ` +
        (serialFitRatio > 0.85 && serialFitRatio < 1.3
          ? "~1.0, consistent with full FIFO serialization (no parallel inference observed)."
          : serialFitRatio <= 0.85
            ? "well below 1.0 — later requests finished faster than a strict queue predicts; some overlap/parallelism may be occurring, or reply lengths varied a lot this run."
            : "well above 1.0 — later requests took LONGER than a strict queue predicts; investigate contention beyond simple serialization (thermal throttling, other processes)."),
    );
  } else {
    console.log(`  wall-clock / (concurrency x min-duration): n/a (only computed for --turns=1)`);
  }
  console.log(`  duration p50=${fmtMs(p50)} p95=${fmtMs(p95)} max=${fmtMs(max)} mean=${fmtMs(mean)}`);
  console.log(`  throughput: ${throughputPerSec.toFixed(3)} replies/sec (this run only)`);
  if (failed.length > 0) {
    const byKind = {};
    for (const r of failed) byKind[r.error.kind] = (byKind[r.error.kind] ?? 0) + 1;
    console.log(`  error breakdown: ${JSON.stringify(byKind)}`);
  }

  console.log("\n--- CLASSROOM VERDICT ---");
  if (p50 === null) {
    console.log("  No successful replies this run — cannot project a classroom wait time.");
  } else {
    const projectedP50Ms = args.classroomSize * p50;
    const projectedP95Ms = args.classroomSize * (p95 ?? p50);
    console.log(
      `  Measured serial pace this run: p50=${fmtSec(p50)}/reply, p95=${fmtSec(p95 ?? p50)}/reply ` +
        `(n=${ok.length} successful replies, concurrency=${args.concurrency}, turns=${args.turns}).`,
    );
    console.log(
      `  Serialization check: wall-clock ${fmtSec(wallClockMs)} vs concurrency(${args.concurrency}) x ` +
        `min-duration(${fmtSec(minDurationMs)}) = ${fmtSec(predictedSerialWallClockMs)} predicted-if-serial ` +
        `(fit ratio ${serialFitRatio === null ? "n/a" : serialFitRatio.toFixed(2)}) — ` +
        (serialFitRatio !== null && serialFitRatio > 0.85 && serialFitRatio < 1.3
          ? "consistent with full FIFO serialization (no parallel inference observed)."
          : "NOT consistent with full serialization — investigate before trusting the projection below."),
    );
    console.log(
      `  Projected wait for the ${args.classroomSize}th student (all sending around the same time, ` +
        `one Ollama instance serving them in submission order):`,
    );
    console.log(
      `    ${args.classroomSize} x ${fmtSec(p50)} (p50 pace) = ${fmtSec(projectedP50Ms)} (~${(projectedP50Ms / 60000).toFixed(1)} min)`,
    );
    console.log(
      `    ${args.classroomSize} x ${fmtSec(p95 ?? p50)} (p95 pace, pessimistic) = ${fmtSec(projectedP95Ms)} (~${(projectedP95Ms / 60000).toFixed(1)} min)`,
    );
    const timeoutFlag = (label, ms) =>
      ms >= NON_STREAMING_TIMEOUT_MS
        ? `  *** AT/PAST the ${fmtSec(NON_STREAMING_TIMEOUT_MS)} non-streaming request timeout ` +
          `(OllamaProvider.GENERATE_TIMEOUT_MS) — ${label} would see their request TIME OUT, not just arrive late. ***`
        : `  (${fmtSec(NON_STREAMING_TIMEOUT_MS - ms)} of headroom before the ${fmtSec(NON_STREAMING_TIMEOUT_MS)} non-streaming timeout)`;
    console.log(`    p50 projection${timeoutFlag(`the ${args.classroomSize}th student`, projectedP50Ms)}`);
    console.log(`    p95 projection${timeoutFlag(`the ${args.classroomSize}th student`, projectedP95Ms)}`);
    if (args.concurrency < args.classroomSize) {
      console.log(
        `  NOTE: this run used --concurrency=${args.concurrency}, a fraction of a full ` +
          `${args.classroomSize}-student classroom. This projection extrapolates a small sample —` +
          ` run the real ${args.classroomSize}-way test (see the FULL 15-WAY PROCEDURE in this ` +
          `script's header comment) on a quiet box before treating it as a go/no-go number.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("=== Sage classroom concurrency instrument ===");
  console.log(
    `model=${args.model} url=${args.url} concurrency=${args.concurrency} turns=${args.turns} ` +
      `maxOutputTokens=${args.maxOutputTokens} promptChars=${args.promptChars} classroomSize=${args.classroomSize}`,
  );

  const t0 = process.hrtime.bigint();
  const now = () => Number(process.hrtime.bigint() - t0) / 1e6;

  const clientPromises = Array.from({ length: args.concurrency }, (_, i) =>
    runClient({ args, clientIndex: i + 1, now }),
  );
  const perClientResults = await Promise.all(clientPromises);
  const wallClockMs = now();
  const allResults = perClientResults.flat();

  report(allResults, wallClockMs, args);

  if (args.jsonOut) {
    writeFileSync(
      args.jsonOut,
      JSON.stringify({ args: { ...args }, wallClockMs, results: allResults }, null, 2),
    );
    console.log(`\nWrote full per-request results to ${args.jsonOut}`);
  }

  const anyErrors = allResults.some((r) => r.outcome === "error");
  // Report-only tool: an error is exactly the signal this instrument exists
  // to surface, not a reason to fail the process. Exit 0 always; the human
  // reads the CLASSROOM VERDICT.
  if (anyErrors) {
    console.log("\n(one or more requests errored — see error breakdown above; this is data, not a crash)");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
