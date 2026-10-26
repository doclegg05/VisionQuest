#!/usr/bin/env node
// =============================================================================
// classroom-concurrency — a REAL N=1/5/15 measurement, not a projection.
//
// design §4.7 "Classroom concurrency": p50 reply time at 15 concurrent
// students, "re-measured, not projected (the current 9.0-minute figure is
// arithmetic, not a run)". This suite runs the fixed ladder N = 1, 5, 15
// against the REAL local Ollama provider by importing scripts/sage-load-
// test.mjs's own `runClient` — no copied logic, and no invented shortcut: at
// each N, N clients actually send a turn concurrently, exactly like that
// script's `--concurrency=N --turns=1`, and duration is measured the same
// non-streaming way (see that file's header for why that is a faithful
// apples-to-apples signal here).
//
// This suite cannot run in this container (no local Ollama). It is `manual`
// tier, `requires: ["ollama"]`, and declares `"host": "recorded"` — an
// operator runs it on the real host with `npm run bench --
// --suite=classroom-concurrency`, and the result carries that host's
// fingerprint (design §6, "record the host": every prior local-model number
// in this repo's history has had an unrecorded host, which is why they
// contradict each other).
//
// QUEUE WAIT is not directly observable client-side (a non-streaming call
// bundles queue-wait and generation time into one duration — see
// sage-load-test.mjs's report() comment on the same limitation). This suite
// uses the same proxy that file's "serialization fit" check uses in spirit:
// the N=1 run has no queue by construction, so its p50/p95 duration is the
// baseline "pure compute" cost, and `queue_wait_p50_ms_n<N>` /
// `queue_wait_p95_ms_n<N>` report each higher-N duration MINUS that
// baseline. A near-zero queue wait at N=5 that grows sharply at N=15 is
// exactly the "Ollama is serial and a classroom-sized burst pays for it"
// signal the design asks this suite to make visible.
//
//   OLLAMA_HOST=http://localhost:11434 npm run bench -- --suite=classroom-concurrency
//   OLLAMA_HOST=http://localhost:11434 node --import tsx scripts/bench/suites/classroom-concurrency.mjs --self-test
// =============================================================================

import { percentile } from "../../lib/percentile.mjs";
import { selfTest } from "../lib/self-test.mjs";

export const CONCURRENCY_LEVELS = Object.freeze([1, 5, 15]);

/** Pure percentile summary over one level's per-client durations — unit-testable without Ollama. */
export function summarizeDurations(durationsMs) {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  return { n: sorted.length, p50Ms: percentile(sorted, 50) ?? 0, p95Ms: percentile(sorted, 95) ?? 0 };
}

/** queue-wait proxy: this level's duration minus the N=1 baseline duration, floored at 0 (a faster-than-baseline sample is noise, not negative queueing). */
export function queueWaitMs(levelMs, baselineMs) {
  return Math.max(0, levelMs - baselineMs);
}

export async function run(ctx) {
  const fixture = ctx.fixture ?? {};
  const url = fixture.url || ctx.env?.ollamaHost || process.env.OLLAMA_URL || "http://localhost:11434";
  const model = fixture.model || process.env.OLLAMA_MODEL || "gemma4:latest";
  const maxOutputTokens = fixture.maxOutputTokens ?? 768;
  const promptChars = fixture.promptChars ?? 20_000;
  const turns = fixture.turns ?? 1;
  const levels = fixture.concurrencyLevels ?? CONCURRENCY_LEVELS;

  const { runClient, createOllamaProvider } = await import("../../sage-load-test.mjs");

  const args = { url, model, maxOutputTokens, promptChars, turns };

  // One untimed warm-up call so the model is resident before N=1 is
  // measured — production sends keep_alive on every call (OllamaProvider),
  // and this suite must not fight that the way sage-load-test.mjs's own
  // 15-way procedure says not to evict/touch KEEP_ALIVE.
  ctx.log?.(`warming ${model} at ${url}...`);
  const warmupProvider = await createOllamaProvider({ url, model, maxOutputTokens });
  await warmupProvider.generateResponse(
    "[SYNTHETIC LOAD TEST] warm-up call, not measured.",
    [{ role: "user", content: "Say ok." }],
  );

  const byLevel = {};
  for (const n of levels) {
    const t0 = process.hrtime.bigint();
    const now = () => Number(process.hrtime.bigint() - t0) / 1e6;
    const clientPromises = Array.from({ length: n }, (_, i) => runClient({ args, clientIndex: i + 1, now }));
    const perClientResults = await Promise.all(clientPromises);
    const wallClockMs = now();
    const allResults = perClientResults.flat();
    const ok = allResults.filter((r) => r.outcome === "ok");
    const failed = allResults.filter((r) => r.outcome === "error");
    const summary = summarizeDurations(ok.map((r) => r.durationMs));
    byLevel[n] = { ...summary, wallClockMs, okCount: ok.length, errorCount: failed.length };
    ctx.log?.(
      `n=${n}: ok=${ok.length} error=${failed.length} p50=${summary.p50Ms.toFixed(0)}ms ` +
        `p95=${summary.p95Ms.toFixed(0)}ms wallClock=${wallClockMs.toFixed(0)}ms`,
    );
  }

  const baselineP50 = byLevel[1]?.p50Ms ?? 0;
  const baselineP95 = byLevel[1]?.p95Ms ?? 0;

  const metrics = [];
  for (const n of levels) {
    metrics.push({
      id: `p50_ms_n${n}`,
      value: Math.round(byLevel[n].p50Ms),
      n: byLevel[n].n,
      details: byLevel[n],
    });
    metrics.push({
      id: `p95_ms_n${n}`,
      value: Math.round(byLevel[n].p95Ms),
      n: byLevel[n].n,
      details: byLevel[n],
    });
    metrics.push({
      id: `queue_wait_p50_ms_n${n}`,
      value: Math.round(queueWaitMs(byLevel[n].p50Ms, baselineP50)),
      n: byLevel[n].n,
      details: { baselineP50, levelP50: byLevel[n].p50Ms },
    });
    metrics.push({
      id: `queue_wait_p95_ms_n${n}`,
      value: Math.round(queueWaitMs(byLevel[n].p95Ms, baselineP95)),
      n: byLevel[n].n,
      details: { baselineP95, levelP95: byLevel[n].p95Ms },
    });
  }

  return { metrics, provider: "ollama", model };
}

await selfTest(import.meta.url, run);
