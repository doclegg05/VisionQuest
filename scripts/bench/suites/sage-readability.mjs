/**
 * Benchmark: sage-readability. See config/benchmarks/sage-readability.json.
 *
 * Self-test:
 *   GEMINI_API_KEY=... node --import tsx scripts/bench/suites/sage-readability.mjs --self-test
 */

import { maybeRunSelfTest } from "./lib/self-test.mjs";
import { runChatHarnessFamily, passRateFromBucket } from "./lib/chat-harness-family.mjs";

/** Pure median over grade numbers — unit-testable. */
export function medianGrade(caseResults) {
  const grades = caseResults.map((r) => r.grade).filter((g) => typeof g === "number").sort((a, b) => a - b);
  if (grades.length === 0) return null;
  const mid = Math.floor(grades.length / 2);
  return grades.length % 2 === 0 ? (grades[mid - 1] + grades[mid]) / 2 : grades[mid];
}

export async function run(ctx) {
  const geminiApiKey = ctx.env?.geminiApiKey ?? process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error("sage-readability requires GEMINI_API_KEY.");
  }

  const { bucket, caseResults } = await runChatHarnessFamily("readability", { geminiApiKey });
  const { evaluated, passRate } = passRateFromBucket(bucket);

  return {
    metrics: [
      {
        id: "pass_rate",
        value: passRate ?? 0,
        n: evaluated,
        details: { failing: caseResults.filter((r) => r.pass === false).map((r) => ({ id: r.id, grade: r.grade })) },
      },
      { id: "median_grade", value: medianGrade(caseResults) ?? 0, n: evaluated },
    ],
  };
}

await maybeRunSelfTest({ suite: "sage-readability", run, importMeta: import.meta });
