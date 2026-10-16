#!/usr/bin/env node
// =============================================================================
// explain-faithfulness — the model half.
//
// Generates a real explanation for each of the ten fixture postings and runs
// the same guard `explain_job` runs on its own draft. Nightly, because it costs
// money and because a model is not deterministic; the deterministic sibling
// `explain-faithfulness-check` is what gates a pull request.
//
//   faithful_explanations — drafts the checker accepts / drafts generated. 1.0
//   median_reading_grade  — the FK grade a student actually gets.         ≤ 6
//   empty_replies         — turns that came back with no visible content.   0
//
// `empty_replies` is here because of a specific, repeated failure in this
// repository: a local model returning "" for three unrelated reasons, none of
// which surfaced as an error. A faithfulness ratio computed over drafts that do
// not exist would read as a perfect score.
//
// THE PROMPT IS IMPORTED, NEVER COPIED. `EXPLAIN_SYSTEM_PROMPT` and
// `explainGrounding` come from job-search-tools.ts, so the benchmark measures
// what the product sends. A copied prompt drifts, and then the number describes
// a system nobody ships.
//
// THE MODEL IS PRODUCTION'S, REACHED THROUGH OPENROUTER. The repo has no
// Gemini key (issue #220), and the app's resolveAiProvider never returns
// OpenRouter by design, so this suite generates through the eval resolver
// every Sage eval uses. It still measures the shipped prompt and the shipped
// guard; it no longer exercises production's provider routing.
//
//   OPENROUTER_API_KEY=… \
//     node --import tsx scripts/bench/suites/explain-faithfulness.mjs --self-test
// =============================================================================

import { selfTest } from "../lib/self-test.mjs";

export async function run(ctx) {
  if (!ctx.env.openrouterApiKey) {
    return { skipped: "no OPENROUTER_API_KEY — this suite generates with a real model" };
  }

  const { EXPLAIN_SYSTEM_PROMPT, explainGrounding } = await import(
    "../../../src/lib/sage/agent/job-search-tools.ts"
  );
  const { checkExplanationFaithfulness } = await import(
    "../../../src/lib/sage/agent/explain-faithfulness.ts"
  );
  const { resolveEvalProvider } = await import("../../lib/sage-eval-provider.mjs");
  const { assessReadability } = await import("../../../src/lib/sage/readability.ts");
  const { percentile } = await import("../../../src/lib/percentile.ts");

  const { provider, model } = await resolveEvalProvider(["--provider=openrouter"]);

  const results = [];
  let empty = 0;

  for (const posting of ctx.fixture.postings) {
    const grounding = explainGrounding({
      title: posting.title,
      company: posting.company,
      location: posting.location,
      salary: posting.salary,
      employmentType: posting.employmentType,
      description: posting.description,
    });

    const draft = (
      await provider.generateResponse(EXPLAIN_SYSTEM_PROMPT, [
        { role: "user", content: `${grounding}\n\nWrite the five sections now.` },
      ])
    ).trim();

    if (draft.length === 0) {
      empty += 1;
      results.push({ postingId: posting.id, empty: true, findings: [], grade: null });
      continue;
    }

    const findings = checkExplanationFaithfulness(draft, posting);
    results.push({
      postingId: posting.id,
      empty: false,
      findings: findings.map((finding) => `${finding.kind}: ${finding.detail}`),
      grade: assessReadability(draft).grade,
      // The draft itself, so a nightly failure can be read rather than
      // re-run. Truncated: this lands in a committed result file.
      draft: findings.length > 0 ? draft.slice(0, 800) : undefined,
    });
  }

  const generated = results.filter((entry) => !entry.empty);
  const clean = generated.filter((entry) => entry.findings.length === 0);
  const grades = generated.map((entry) => entry.grade).filter((grade) => grade !== null);

  return {
    provider: provider.name,
    model,
    metrics: [
      {
        id: "faithful_explanations",
        value: generated.length === 0 ? 0 : Number((clean.length / generated.length).toFixed(4)),
        n: generated.length,
        details: { unfaithful: results.filter((entry) => entry.findings.length > 0) },
      },
      {
        id: "median_reading_grade",
        value: grades.length === 0 ? 0 : Number(percentile(grades, 50).toFixed(2)),
        n: grades.length,
      },
      { id: "empty_replies", value: empty, n: ctx.fixture.postings.length },
    ],
  };
}

await selfTest(import.meta.url, run);
