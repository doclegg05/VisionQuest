/**
 * Benchmark: rag-abstention.
 *
 * See config/benchmarks/rag-abstention.json for why this reuses
 * scripts/sage-rag-harness.mjs (which exercises the REAL, configured
 * abstention gate via getDocumentContext) rather than
 * scripts/sage-rag-calibrate-abstention.mjs (which deliberately disables
 * the gate to calibrate its floor).
 *
 * Self-test:
 *   BENCH_PROD_READONLY_URL=postgresql://... \
 *     node --import tsx scripts/bench/suites/rag-abstention.mjs --self-test
 */

import { maybeRunSelfTest } from "./lib/self-test.mjs";
import { runScriptForJsonReport } from "./lib/run-cli.mjs";

/** Pure scoring over the harness's per-question results — unit-testable. */
export function scoreAbstention(results) {
  const inCorpus = results.filter((r) => (r.expectedStorageKeys ?? []).length > 0);
  const offTopic = results.filter((r) => r.noAnswerOk !== null && r.noAnswerOk !== undefined);

  const falseAbstains = inCorpus.filter((r) => !r.hasContext);
  const correctAbstains = offTopic.filter((r) => r.noAnswerOk === true);

  return {
    inCorpusTotal: inCorpus.length,
    falseAbstainCount: falseAbstains.length,
    falseAbstainRate: inCorpus.length ? falseAbstains.length / inCorpus.length : 0,
    offTopicTotal: offTopic.length,
    offtopicAbstainRate: offTopic.length ? correctAbstains.length / offTopic.length : 0,
    falseAbstainIds: falseAbstains.map((r) => r.id),
  };
}

export async function run(ctx) {
  const dbUrl = ctx.env?.prodReadonlyUrl ?? process.env.BENCH_PROD_READONLY_URL;
  if (!dbUrl) {
    throw new Error(
      "rag-abstention requires BENCH_PROD_READONLY_URL (a read-only prod replica) — see config/benchmarks/rag-abstention.json notes.",
    );
  }

  const fixturePath = ctx.fixturePath ?? "config/sage-rag-eval.json";
  const report = await runScriptForJsonReport("scripts/sage-rag-harness.mjs", [`--fixture=${fixturePath}`], {
    env: { DATABASE_URL: dbUrl },
  });

  const scored = scoreAbstention(report.results ?? []);

  return {
    metrics: [
      {
        id: "false_abstain_rate",
        value: scored.falseAbstainRate,
        n: scored.inCorpusTotal,
        details: { falseAbstainIds: scored.falseAbstainIds },
      },
      { id: "offtopic_abstain_rate", value: scored.offtopicAbstainRate, n: scored.offTopicTotal },
    ],
  };
}

await maybeRunSelfTest({ suite: "rag-abstention", run, importMeta: import.meta });
