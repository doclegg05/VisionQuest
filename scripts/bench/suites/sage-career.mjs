/**
 * Benchmark: sage-career. See config/benchmarks/sage-career.json — watch
 * tier, no floor, until the 40-question CareerOneStop-grounded corpus lands.
 *
 * Self-test:
 *   OPENROUTER_API_KEY=... node --import tsx scripts/bench/suites/sage-career.mjs --self-test
 */

import { maybeRunSelfTest } from "./lib/self-test.mjs";
import { runChatHarnessFamily, passRateFromBucket } from "./lib/chat-harness-family.mjs";

export async function run(ctx) {
  const openrouterApiKey = ctx.env?.openrouterApiKey ?? process.env.OPENROUTER_API_KEY;
  if (!openrouterApiKey) {
    throw new Error("sage-career requires OPENROUTER_API_KEY.");
  }

  const { report, bucket, caseResults } = await runChatHarnessFamily("career", { openrouterApiKey });
  const { evaluated, passRate } = passRateFromBucket(bucket);

  return {
    metrics: [
      {
        id: "pass_rate",
        value: passRate ?? 0,
        n: evaluated,
        details: { provider: report.provider, failing: caseResults.filter((r) => r.pass === false).map((r) => ({ id: r.id, reason: r.reason })) },
      },
    ],
  };
}

await maybeRunSelfTest({ suite: "sage-career", run, importMeta: import.meta });
