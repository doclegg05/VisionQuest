#!/usr/bin/env node
/**
 * Deterministic answer-time selection harness for SPOKES forms.
 *
 * sage-form-harness.mjs measures RANKING (does the right form land in
 * top-1/top-3?). This harness measures the answer-time DISAMBIGUATION layer
 * added on top of ranking — the part that actually fixes the cleanTop3 gap,
 * since you can't push a sibling out of the index (see
 * docs/superpowers/specs/2026-06-30-okf-phase1-findings-and-reassessment.md).
 *
 * Deliberately NOT an LLM-judge eval (flaky, expensive, hard to diff in CI).
 * Both checks below are structural/deterministic:
 *
 *   1. getDirectFormAnswer (knowledge-base.ts) — for fixture cases with
 *      forbiddenFormIds, the no-model shortcut must either bypass (return
 *      null, deferring to the agent) or, if it answers directly, the
 *      expected form must actually be present in that answer. A confident
 *      answer that omits the expected form and only shows a forbidden
 *      sibling is exactly the measured failure (attendance-contract query ->
 *      Sign-in Sheet only).
 *   2. search_forms tool modelHint (tools.ts) — when a forbidden sibling
 *      rides along in the ranked candidates (the cleanTop3 miss), the
 *      modelHint must carry the disambiguation block so the model has
 *      something to reason with beyond raw rank order.
 *
 * Usage:
 *   npm run sage:form:selection:harness
 *   npm run sage:form:selection:harness -- --strict
 */
import { readFileSync } from "node:fs";
import { loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const DISAMBIGUATION_MARKER = "easy to mix up";

async function main() {
  const args = parseArgs();
  const fixturePath = args.fixture || "config/sage-form-eval.json";
  const { cases } = JSON.parse(readFileSync(fixturePath, "utf8"));
  const ambiguousCases = cases.filter((c) => (c.forbiddenFormIds ?? []).length > 0);

  const { getDirectFormAnswer, messageHasFormIntent, findRelevantForms } = await import(
    "../src/lib/sage/knowledge-base.ts"
  );
  const { isKnownAmbiguousForm } = await import("../src/lib/catalog/notes.ts");
  const { getToolByName } = await import("../src/lib/sage/agent/tools.ts");
  const searchFormsTool = getToolByName("search_forms");
  if (!searchFormsTool) throw new Error("search_forms tool not found");

  const fakeCtx = { session: { role: "student" } };
  const results = [];

  for (const c of ambiguousCases) {
    const expected = c.expectedFormIds ?? [];
    const forbidden = c.forbiddenFormIds ?? [];

    // ---- Check 1: getDirectFormAnswer never confidently omits the expected form ----
    const directAnswer = getDirectFormAnswer(c.query);
    const directBypassed = directAnswer === null;
    const directMentionsExpected =
      directBypassed || expected.some((id) => directAnswer.includes(`formId=${id}`));
    const directSafe = directBypassed || directMentionsExpected;

    // Why did the direct answer bypass? Distinguish the NEW ambiguity bypass
    // from the pre-existing FORM_INTENT_WORDS gate / no-candidates path, so the
    // headline pass count doesn't overstate how many cases exercise new code.
    const hasIntent = messageHasFormIntent(c.query);
    const ranked = findRelevantForms(c.query);
    const reachesNewBypass =
      hasIntent && ranked.length > 0 && ranked.some(({ form }) => isKnownAmbiguousForm(form.id));
    const directBypassReason = !directBypassed
      ? "answered-directly"
      : !hasIntent
        ? "pre-existing: no form-intent words"
        : ranked.length === 0
          ? "pre-existing: no candidates"
          : "NEW: ambiguity bypass";

    // ---- Check 2: search_forms modelHint carries disambiguation when a
    // forbidden sibling actually rides along in the ranked candidates ----
    const toolResult = await searchFormsTool.execute({ query: c.query, limit: 3 }, fakeCtx);
    const candidateIds = (toolResult.data?.candidates ?? []).map((cand) => cand.id);
    const forbiddenPresent = forbidden.some((id) => candidateIds.includes(id));
    const modelHint = toolResult.modelHint ?? "";
    const hasDisambiguation = modelHint.includes(DISAMBIGUATION_MARKER);
    // Only required when there's something to disambiguate; absence is fine
    // (and expected) when the forbidden sibling never made the candidate set.
    const selectionSafe = !forbiddenPresent || hasDisambiguation;

    results.push({
      id: c.id,
      query: c.query,
      directBypassed,
      directBypassReason,
      reachesNewBypass,
      directSafe,
      candidateIds,
      forbiddenPresent,
      hasDisambiguation,
      selectionSafe,
      pass: directSafe && selectionSafe,
    });
  }

  const total = results.length;
  const directPass = results.filter((r) => r.directSafe).length;
  const selectionPass = results.filter((r) => r.selectionSafe).length;
  const allPass = results.filter((r) => r.pass).length;
  // Honest coverage: of the ambiguous cases, how many actually drive the new
  // ambiguity-bypass code vs. pass via a pre-existing gate (also safe, but not
  // a test of this feature) or via the modelHint disambiguation path.
  const exerciseNewBypass = results.filter((r) => r.reachesNewBypass).length;
  const exerciseDisambiguation = results.filter((r) => r.forbiddenPresent).length;

  if (args.json) {
    console.log(JSON.stringify({ fixturePath, total, directPass, selectionPass, allPass, exerciseNewBypass, exerciseDisambiguation, results }, null, 2));
  } else {
    console.log("\nVisionQuest Sage Form Selection Harness (answer-time disambiguation)");
    console.log(`Fixture: ${fixturePath} (${total} ambiguous-by-design cases)`);
    console.log(`getDirectFormAnswer safe (bypassed or mentions expected): ${directPass}/${total}`);
    console.log(`search_forms modelHint disambiguates when needed: ${selectionPass}/${total}`);
    console.log(`Overall: ${allPass}/${total}`);
    console.log(
      `Coverage: ${exerciseNewBypass}/${total} cases drive the new getDirectFormAnswer ambiguity bypass; ` +
        `${exerciseDisambiguation}/${total} put a forbidden sibling in the candidate set (exercise modelHint disambiguation). ` +
        `Cases passing only via the pre-existing form-intent gate are safe but don't test this feature.\n`,
    );
    for (const r of results) {
      const mark = r.pass ? "PASS" : "FAIL";
      console.log(`${mark} ${r.id}: ${r.query}`);
      console.log(
        `  direct: ${r.directBypassReason}${r.directSafe ? "" : "  <-- unsafe"}; ` +
          `candidates: ${r.candidateIds.join(", ")}; forbiddenPresent: ${r.forbiddenPresent}; ` +
          `disambiguated: ${r.hasDisambiguation}${r.selectionSafe ? "" : "  <-- missing disambiguation"}`,
      );
    }
  }

  if (args.strict && allPass !== total) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Selection harness failed:", error);
  process.exitCode = 1;
});
