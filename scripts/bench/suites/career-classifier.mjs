#!/usr/bin/env node
// =============================================================================
// career-classifier — bake-off: today's Gemini discovery extractor vs Jev.
//
// Both arms read the same synthetic career-discovery conversation and must name
// the student's best-fit SPOKES pathway (7 options) and national career cluster
// (14 options). The question is whether TypeSafe's Jev classifier is worth
// adding for career classification; see the research notes in the PR.
//
//   Gemini arm  extractDiscoverySignals, imported from production with its real
//               prompt, on a GeminiProvider. Top-1 is the highest cluster score.
//   Jev arm     two Choice questions (SPOKES, national) over the same last-10
//               message window. Asked twice, the second time with every option
//               list reversed, because Jev's own docs say it leans toward the
//               first option; the forward call is the prediction and the pair
//               gives the order-flip rate.
//
// Information parity, stated so the numbers are read correctly:
//   national  both arms see the 14 cluster NAMES only. Like for like.
//   SPOKES    the extractor prompt lists ids only; Jev gets each pathway's
//             production label and description (career-clusters.ts), which is
//             how it would be deployed. A Jev lead here may partly be the
//             descriptions, and that is also a cheap fix for the Gemini prompt.
//
// Manual tier, no floors: this informs one decision and gates nothing.
// Synthetic fixture only (config/benchmarks/fixtures/career-classifier.json);
// typesafe-client.mjs bypasses the AI resolver and must never see student data.
//
//   GEMINI_API_KEY=… TYPESAFE_API_KEY=… npm run bench -- --suite=career-classifier
//   BENCH_CAREER_LIMIT=4   first 4 English cases and their Spanish pairs (smoke)
//   BENCH_JEV_MODEL        default jev-1.13.0 (pinned; jev-latest moves)
//   TYPESAFE_API_BASE      default https://api.typesafe.ai
// =============================================================================

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { selfTest } from "../lib/self-test.mjs";
import {
  brierScore,
  flipRate,
  isTop1Correct,
  nationalScoreMap,
  summarize,
  toDistribution,
  topLabels,
  transcriptState,
  validateFixture,
} from "./lib/career-classifier-score.mjs";
import {
  TYPESAFE_DEFAULT_BASE,
  TYPESAFE_DEFAULT_MODEL,
  callSystemOne,
  choiceQuestion,
  parseChoiceAnswer,
} from "./lib/typesafe-client.mjs";

/** TypeSafe's published input price, October 2026. Output is not billed. */
const JEV_USD_PER_MILLION_INPUT_TOKENS = 0.042;

const SPOKES_INSTRUCTIONS =
  "This is a career discovery conversation between Sage, a job coach, and a student in a " +
  "workforce training program. Using only interests the student has clearly expressed or " +
  "agreed with, which training pathway fits the student best?";
const NATIONAL_INSTRUCTIONS =
  "This is a career discovery conversation between Sage, a job coach, and a student in a " +
  "workforce training program. Using only interests the student has clearly expressed or " +
  "agreed with, which career cluster best fits the work the student is drawn to?";

async function loadProduction() {
  const { CAREER_CLUSTERS } = await import("../../../src/lib/spokes/career-clusters.ts");
  const { NATIONAL_CAREER_CLUSTERS } = await import("../../../src/lib/spokes/national-clusters.ts");
  const { extractDiscoverySignals } = await import("../../../src/lib/sage/discovery-extractor.ts");
  const { GeminiProvider } = await import("../../../src/lib/ai/gemini-provider.ts");
  return { CAREER_CLUSTERS, NATIONAL_CAREER_CLUSTERS, extractDiscoverySignals, GeminiProvider };
}

/** Jev option keys: SPOKES ids as-is; national names slugged, name as the description. */
export function buildVocab(production) {
  const spokesOptions = production.CAREER_CLUSTERS.map((cluster) => ({
    key: cluster.id,
    description: `${cluster.label}: ${cluster.description}`,
  }));
  const nationalOptions = production.NATIONAL_CAREER_CLUSTERS.map((name) => ({
    key: name.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, ""),
    description: name,
  }));
  return {
    spokesIds: spokesOptions.map((option) => option.key),
    nationalNames: [...production.NATIONAL_CAREER_CLUSTERS],
    nationalKeyToName: Object.fromEntries(nationalOptions.map((option) => [option.key, option.description])),
    spokesOptions,
    nationalOptions,
  };
}

export function jevQuestions(vocab, reversed) {
  const order = (options) => (reversed ? [...options].reverse() : options);
  return {
    spokes: choiceQuestion(SPOKES_INSTRUCTIONS, order(vocab.spokesOptions)),
    national: choiceQuestion(NATIONAL_INSTRUCTIONS, order(vocab.nationalOptions)),
  };
}

/** First `limit` English cases and their Spanish pairs, or every case. */
export function selectCases(cases, limit) {
  if (!Number.isInteger(limit) || limit <= 0) return cases;
  const pairs = new Set(cases.filter((c) => c.lang === "en").slice(0, limit).map((c) => c.id));
  return cases.filter((c) => pairs.has(c.pair));
}

function scoredRow(testCase, vocab, prediction) {
  const { spokesTop, nationalTop, spokesDistribution } = prediction;
  return {
    id: testCase.id,
    lang: testCase.lang,
    difficulty: testCase.difficulty,
    goldSpokes: testCase.gold.spokes,
    goldNational: testCase.gold.national,
    spokesTop,
    nationalTop,
    failed: spokesTop.length === 0,
    correctSpokes: isTop1Correct(spokesTop, testCase.gold.spokes, testCase.acceptable?.spokes),
    correctNational: isTop1Correct(nationalTop, testCase.gold.national, testCase.acceptable?.national),
    brier: brierScore(spokesDistribution, testCase.gold.spokes, vocab.spokesIds),
    latencyMs: prediction.latencyMs,
    confidence: prediction.confidence ?? null,
    error: prediction.error ?? null,
  };
}

export async function runGeminiCase({ provider, extract }, testCase, vocab) {
  const startedAt = performance.now();
  let result = null;
  let error = null;
  try {
    result = await extract(provider, testCase.messages);
  } catch (caught) {
    // The extractor swallows its own failures today and returns an empty
    // result; this catch covers it once it throws instead. Both read as failed.
    error = caught instanceof Error ? caught.message.slice(0, 200) : "extractor threw";
  }
  const spokesScores = result?.cluster_scores ?? {};
  return scoredRow(testCase, vocab, {
    spokesTop: topLabels(spokesScores, vocab.spokesIds),
    nationalTop: topLabels(nationalScoreMap(result?.national_career_clusters), vocab.nationalNames),
    spokesDistribution: toDistribution(spokesScores, vocab.spokesIds),
    latencyMs: Math.round(performance.now() - startedAt),
    error,
  });
}

function parseJevPair(forward, reverse, vocab) {
  const nationalKeys = vocab.nationalOptions.map((option) => option.key);
  const spokes = parseChoiceAnswer(forward.answers.spokes, vocab.spokesIds);
  const national = parseChoiceAnswer(forward.answers.national, nationalKeys);
  const spokesReversed = parseChoiceAnswer(reverse.answers.spokes, vocab.spokesIds);
  const nationalReversed = parseChoiceAnswer(reverse.answers.national, nationalKeys);
  return { spokes, national, spokesReversed, nationalReversed };
}

export async function runJevCase(jev, testCase, vocab) {
  const state = transcriptState(testCase.messages);
  try {
    const forward = await callSystemOne({ ...jev.request, state, questions: jev.forward });
    const reverse = await callSystemOne({ ...jev.request, state, questions: jev.reversed });
    const answer = parseJevPair(forward, reverse, vocab);
    const row = scoredRow(testCase, vocab, {
      spokesTop: [answer.spokes.choice],
      nationalTop: [vocab.nationalKeyToName[answer.national.choice]],
      spokesDistribution: answer.spokes.probabilities,
      latencyMs: forward.latencyMs,
      confidence: answer.spokes.confidence,
    });
    return {
      row: { ...row, spokesProbabilities: answer.spokes.probabilities },
      flips: {
        spokes: { a: answer.spokes.choice, b: answer.spokesReversed.choice },
        national: { a: answer.national.choice, b: answer.nationalReversed.choice },
      },
      inputTokens: (forward.usage?.input_tokens ?? 0) + (reverse.usage?.input_tokens ?? 0),
      model: forward.model,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Jev call failed";
    const row = scoredRow(testCase, vocab, { spokesTop: [], nationalTop: [], spokesDistribution: null, latencyMs: null, error: message });
    return { row, flips: null, inputTokens: 0, model: null };
  }
}

function jevConfig(vocab, env = process.env) {
  const apiKey = env.TYPESAFE_API_KEY?.trim() || "";
  if (!apiKey) return null;
  return {
    request: {
      apiKey,
      model: env.BENCH_JEV_MODEL?.trim() || TYPESAFE_DEFAULT_MODEL,
      baseUrl: env.TYPESAFE_API_BASE?.trim() || TYPESAFE_DEFAULT_BASE,
    },
    forward: jevQuestions(vocab, false),
    reversed: jevQuestions(vocab, true),
  };
}

async function runJevArm(jev, cases, vocab) {
  const outcomes = [];
  for (const testCase of cases) outcomes.push(await runJevCase(jev, testCase, vocab));
  const flips = outcomes.map((outcome) => outcome.flips).filter(Boolean);
  const inputTokens = outcomes.reduce((sum, outcome) => sum + outcome.inputTokens, 0);
  return {
    rows: outcomes.map((outcome) => outcome.row),
    model: outcomes.find((outcome) => outcome.model)?.model ?? jev.request.model,
    flipSpokes: flipRate(flips.map((flip) => flip.spokes)),
    flipNational: flipRate(flips.map((flip) => flip.national)),
    flipBoth: flipRate(flips.flatMap((flip) => [flip.spokes, flip.national])),
    inputTokens,
    estimatedUsd: Number(((inputTokens / 1_000_000) * JEV_USD_PER_MILLION_INPUT_TOKENS).toFixed(6)),
  };
}

function langSplit(summary, field) {
  return Object.fromEntries(Object.entries(summary.byLang).map(([lang, part]) => [lang, part[field]]));
}

function armMetrics(prefix, summary, skipped, artifactPath) {
  const value = (field) => (summary ? summary[field] : null);
  const details = (field) =>
    summary ? { byLang: langSplit(summary, field), artifactPath } : { skipped, artifactPath };
  return [
    { id: `${prefix}_spokes_top1`, value: value("spokesTop1"), n: value("n"), details: details("spokesTop1") },
    { id: `${prefix}_national_top1`, value: value("nationalTop1"), n: value("n"), details: details("nationalTop1") },
    { id: `${prefix}_failure_rate`, value: value("failureRate"), n: value("n"), details: details("failureRate") },
    { id: `${prefix}_spokes_brier`, value: value("spokesBrier"), n: value("n"), details: details("spokesBrier") },
    { id: `${prefix}_p50_ms`, value: value("p50Ms"), n: value("n"), details: details("p50Ms") },
  ];
}

function writeArtifact(repoRoot, payload) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactPath = `reports/benchmarks/career-classifier/${stamp}.json`;
  const absolute = path.join(repoRoot, artifactPath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(payload, null, 2)}\n`);
  return artifactPath;
}

export async function run(ctx) {
  if (!ctx.env.geminiApiKey) {
    return { skipped: "no GEMINI_API_KEY — the baseline arm is the production Gemini extractor" };
  }
  const production = await loadProduction();
  const vocab = buildVocab(production);
  const problems = validateFixture(ctx.fixture, vocab);
  if (problems.length > 0) {
    throw new Error(`fixture is not usable (${problems.length} problems): ${problems.slice(0, 10).join("; ")}`);
  }

  const cases = selectCases(ctx.fixture.cases, Number(process.env.BENCH_CAREER_LIMIT));
  const gemini = { provider: new production.GeminiProvider(ctx.env.geminiApiKey), extract: production.extractDiscoverySignals };
  const geminiRows = [];
  for (const testCase of cases) geminiRows.push(await runGeminiCase(gemini, testCase, vocab));

  const jev = jevConfig(vocab);
  const jevRun = jev ? await runJevArm(jev, cases, vocab) : null;
  const geminiModel = production.GeminiProvider.modelName;
  const geminiSummary = summarize(geminiRows);
  const jevSummary = jevRun ? summarize(jevRun.rows) : null;

  const artifactPath = writeArtifact(ctx.repoRoot, {
    generatedAt: new Date().toISOString(),
    commit: ctx.commit,
    host: ctx.host,
    models: { gemini: geminiModel, jev: jevRun?.model ?? null },
    cases: cases.length,
    gemini: { summary: geminiSummary, rows: geminiRows },
    jev: jevRun
      ? { summary: jevSummary, rows: jevRun.rows, orderFlip: { spokes: jevRun.flipSpokes, national: jevRun.flipNational }, inputTokens: jevRun.inputTokens, estimatedUsd: jevRun.estimatedUsd }
      : { skipped: "TYPESAFE_API_KEY is not set" },
  });

  const jevSkip = "TYPESAFE_API_KEY is not set; the Jev arm did not run";
  return {
    provider: jevRun ? "gemini vs typesafe" : "gemini",
    model: jevRun ? `${geminiModel} vs ${jevRun.model}` : geminiModel,
    metrics: [
      ...armMetrics("gemini", geminiSummary, null, artifactPath),
      ...armMetrics("jev", jevSummary, jevSkip, artifactPath),
      {
        id: "jev_order_flip_rate",
        value: jevRun?.flipBoth ?? null,
        n: jevRun ? jevRun.rows.length * 2 : null,
        details: jevRun
          ? { spokes: jevRun.flipSpokes, national: jevRun.flipNational, artifactPath }
          : { skipped: jevSkip, artifactPath },
      },
    ],
  };
}

await selfTest(import.meta.url, run);
