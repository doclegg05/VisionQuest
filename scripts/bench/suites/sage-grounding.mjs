/**
 * Benchmark: sage-grounding. See config/benchmarks/sage-grounding.json.
 *
 * Self-test:
 *   GEMINI_API_KEY=... node --import tsx scripts/bench/suites/sage-grounding.mjs --self-test
 */

import { maybeRunSelfTest } from "./lib/self-test.mjs";
import { runChatHarnessFamily, passRateFromBucket } from "./lib/chat-harness-family.mjs";

export async function run(ctx) {
  const geminiApiKey = ctx.env?.geminiApiKey ?? process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error("sage-grounding requires GEMINI_API_KEY.");
  }

  const { bucket, caseResults } = await runChatHarnessFamily("grounding", { geminiApiKey });
  const { evaluated, passRate } = passRateFromBucket(bucket);

  return {
    metrics: [
      {
        id: "pass_rate",
        value: passRate ?? 0,
        n: evaluated,
        details: { failing: caseResults.filter((r) => r.pass === false).map((r) => ({ id: r.id, reason: r.reason })) },
      },
    ],
  };
}

await maybeRunSelfTest({ suite: "sage-grounding", run, importMeta: import.meta });
