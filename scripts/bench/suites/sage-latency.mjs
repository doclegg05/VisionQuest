/**
 * Benchmark: sage-latency. See config/benchmarks/sage-latency.json.
 *
 * Self-test:
 *   GEMINI_API_KEY=... node --import tsx scripts/bench/suites/sage-latency.mjs --self-test
 */

import { readFileSync } from "node:fs";
import { maybeRunSelfTest } from "./lib/self-test.mjs";
import { percentile } from "../../lib/percentile.mjs";

const CANONICAL_PROMPT_COUNT = 20;

/** Reads the live SLO bar rather than hard-coding it (task requirement). */
export function readCloudChatP95Floor(sloPath = "config/sage-slo.json") {
  const slo = JSON.parse(readFileSync(sloPath, "utf8"));
  const value = slo.perProviderP95Ms?.sage_chat?.gemini;
  if (typeof value !== "number") {
    throw new Error(`${sloPath} has no perProviderP95Ms.sage_chat.gemini bar.`);
  }
  return value;
}

/** Same role->prompt-building shape as sage-chat-harness.mjs's buildPromptForCase. */
export function roleToStagePersona(role) {
  if (role === "teacher") return "teacher";
  if (role === "admin") return "admin";
  return "student";
}

export async function buildPromptForCase(buildSystemPrompt, testCase) {
  const persona = roleToStagePersona(testCase.role);
  if (persona === "teacher") {
    return buildSystemPrompt("teacher_assistant", { studentName: "Ms. Lee", userMessage: testCase.message }, "full");
  }
  if (persona === "admin") {
    return buildSystemPrompt("admin_assistant", { userMessage: testCase.message }, "full");
  }
  return buildSystemPrompt(testCase.stage || "general", { studentName: "Sam", programType: "spokes" }, "full");
}

/** Pure percentile summary over already-measured latencies — unit-testable. */
export function summarizeLatencies(latenciesMs) {
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50Ms: percentile(sorted, 50) ?? 0,
    p95Ms: percentile(sorted, 95) ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

export async function run(ctx) {
  const geminiApiKey = ctx.env?.geminiApiKey ?? process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error("sage-latency requires GEMINI_API_KEY.");
  }

  const floor = readCloudChatP95Floor();

  const fixture = ctx.fixture ?? JSON.parse(readFileSync(ctx.fixturePath ?? "config/sage-chat-eval.json", "utf8"));
  const cases = fixture.slice(0, CANONICAL_PROMPT_COUNT);

  const { resolveEvalProvider } = await import("../../lib/sage-eval-provider.mjs");
  const { buildSystemPrompt } = await import("../../../src/lib/sage/system-prompts.ts");
  const { provider } = await resolveEvalProvider(["--provider=gemini"]);

  const latencies = [];
  const errors = [];
  for (const testCase of cases) {
    const systemPrompt = await buildPromptForCase(buildSystemPrompt, testCase);
    const startedAt = performance.now();
    try {
      await provider.generateResponse(systemPrompt, [{ role: "user", content: testCase.message }], undefined, {});
      latencies.push(Math.round(performance.now() - startedAt));
    } catch (error) {
      errors.push({ id: testCase.id, message: error.message });
    }
  }

  const summary = summarizeLatencies(latencies);

  return {
    metrics: [
      {
        id: "p95_ms",
        value: summary.p95Ms,
        n: summary.n,
        details: { sloBarMs: floor, errors },
      },
      { id: "p50_ms", value: summary.p50Ms, n: summary.n },
    ],
  };
}

await maybeRunSelfTest({ suite: "sage-latency", run, importMeta: import.meta });
