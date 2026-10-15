/**
 * Pure scoring for the career-classifier bake-off: turning each arm's output
 * into a top-1 prediction, a probability distribution, and a summary.
 *
 * Both arms are judged by the same rules:
 *  - A prediction is the set of labels tied for the highest positive score.
 *    A tie is only correct when every tied label is gold or acceptable, so an
 *    arm cannot win by hedging.
 *  - No positive score at all (an empty or all-zero extraction) is a failed
 *    case, and a failed case counts as wrong. A ratio computed only over the
 *    cases that worked would hide exactly the failures worth seeing.
 *  - Brier score is the multi-class form, sum over labels of (p - y)^2, so 0 is
 *    a certain right answer and 2 a certain wrong one. Acceptable labels do not
 *    soften it: it measures calibration against the single gold label.
 */

import { percentile } from "../../../lib/percentile.mjs";

const EXTRACTOR_WINDOW = 10;
const ROUND_TO = 4;
const DIFFICULTIES = new Set(["clear", "indirect", "mixed", "distractor"]);

function round(value) {
  return value === null ? null : Number(value.toFixed(ROUND_TO));
}

function ratio(count, total) {
  return total === 0 ? null : round(count / total);
}

/**
 * @param {Record<string, number>} scores
 * @param {readonly string[]} labels canonical vocabulary, in canonical order
 * @returns {string[]}
 */
export function topLabels(scores, labels) {
  let best = 0;
  for (const label of labels) {
    const value = scores?.[label];
    if (typeof value === "number" && value > best) best = value;
  }
  if (best <= 0) return [];
  return labels.filter((label) => scores[label] === best);
}

/**
 * @param {readonly string[]} top
 * @param {string} gold
 * @param {readonly string[]} [acceptable]
 */
export function isTop1Correct(top, gold, acceptable = []) {
  if (top.length === 0) return false;
  const right = new Set([gold, ...acceptable]);
  return top.every((label) => right.has(label));
}

/**
 * @param {Record<string, number>} scores
 * @param {readonly string[]} labels
 * @returns {Record<string, number>|null}
 */
export function toDistribution(scores, labels) {
  const clean = labels.map((label) => {
    const value = scores?.[label];
    return typeof value === "number" && value > 0 ? value : 0;
  });
  const sum = clean.reduce((total, value) => total + value, 0);
  if (sum <= 0) return null;
  return Object.fromEntries(labels.map((label, i) => [label, clean[i] / sum]));
}

/**
 * @param {Record<string, number>|null} distribution
 * @param {string} gold
 * @param {readonly string[]} labels
 */
export function brierScore(distribution, gold, labels) {
  if (!distribution) return null;
  const total = labels.reduce((sum, label) => {
    const target = label === gold ? 1 : 0;
    return sum + ((distribution[label] ?? 0) - target) ** 2;
  }, 0);
  return round(total);
}

/**
 * The extractor reports national clusters as a list; key it by name.
 *
 * @param {{ cluster_name: string, score: number }[]} entries
 */
export function nationalScoreMap(entries) {
  const scores = {};
  for (const entry of entries ?? []) {
    const previous = scores[entry.cluster_name] ?? -Infinity;
    scores[entry.cluster_name] = Math.max(previous, entry.score);
  }
  return scores;
}

/**
 * The same last-10 window extractDiscoverySignals reads, as plain speaker
 * turns for Jev's state.
 *
 * @param {{ role: "user"|"model", content: string }[]} messages
 */
export function transcriptState(messages) {
  return messages.slice(-EXTRACTOR_WINDOW).map((message) => ({
    speaker: message.role === "model" ? "Sage" : "Student",
    text: message.content,
  }));
}

/** @param {{ a: string, b: string }[]} pairs */
export function flipRate(pairs) {
  return ratio(pairs.filter((pair) => pair.a !== pair.b).length, pairs.length);
}

function summarizeRows(rows) {
  const latencies = rows.map((row) => row.latencyMs).filter((ms) => typeof ms === "number");
  const briers = rows.map((row) => row.brier).filter((value) => typeof value === "number");
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    n: rows.length,
    spokesTop1: ratio(rows.filter((row) => row.correctSpokes).length, rows.length),
    nationalTop1: ratio(rows.filter((row) => row.correctNational).length, rows.length),
    failureRate: ratio(rows.filter((row) => row.failed).length, rows.length),
    spokesBrier: briers.length === 0 ? null : round(briers.reduce((a, b) => a + b, 0) / briers.length),
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
  };
}

function groupBy(rows, key) {
  const groups = {};
  for (const row of rows) {
    groups[row[key]] = [...(groups[row[key]] ?? []), row];
  }
  return Object.fromEntries(Object.entries(groups).map(([name, group]) => [name, summarizeRows(group)]));
}

/**
 * @param {{ lang: string, goldSpokes: string, failed: boolean, correctSpokes: boolean,
 *           correctNational: boolean, brier: number|null, latencyMs: number|null }[]} rows
 */
export function summarize(rows) {
  return {
    ...summarizeRows(rows),
    byLang: groupBy(rows, "lang"),
    byGold: groupBy(rows, "goldSpokes"),
  };
}

function messageProblems(testCase) {
  const messages = testCase.messages ?? [];
  const problems = [];
  if (messages[0]?.role !== "model") problems.push("must start with a Sage turn");
  if (messages.at(-1)?.role !== "user") problems.push("must end with a student turn");
  if (messages.some((message, i) => i > 0 && message.role === messages[i - 1].role)) {
    problems.push("turns must alternate");
  }
  if (messages.some((message) => typeof message.content !== "string" || message.content.trim() === "")) {
    problems.push("every turn needs text");
  }
  return problems;
}

function labelProblems(testCase, field, vocabulary) {
  const problems = [];
  const gold = testCase.gold?.[field];
  const acceptable = testCase.acceptable?.[field] ?? [];
  if (!vocabulary.includes(gold)) problems.push(`unknown gold ${field} "${gold}"`);
  for (const label of acceptable) {
    if (!vocabulary.includes(label)) problems.push(`unknown acceptable ${field} "${label}"`);
  }
  if (acceptable.includes(gold)) problems.push(`acceptable ${field} repeats its gold`);
  return problems;
}

function samePairLabels(a, b) {
  return JSON.stringify({ g: a.gold, x: a.acceptable }) === JSON.stringify({ g: b.gold, x: b.acceptable });
}

function pairProblems(cases) {
  const problems = [];
  const spanishByPair = new Map(cases.filter((c) => c.lang === "es").map((c) => [c.pair, c]));
  for (const english of cases.filter((c) => c.lang === "en")) {
    const spanish = spanishByPair.get(english.id);
    if (!spanish) problems.push(`${english.id}: no Spanish pair`);
    else if (!samePairLabels(english, spanish)) problems.push(`${english.id}: Spanish pair has different labels`);
  }
  return problems;
}

/**
 * Structural check run before a single model call is spent.
 *
 * @param {{ cases: any[] }} fixture
 * @param {{ spokesIds: readonly string[], nationalNames: readonly string[] }} vocab
 * @returns {string[]} problems, empty when the fixture is usable
 */
export function validateFixture(fixture, { spokesIds, nationalNames }) {
  const cases = fixture?.cases ?? [];
  if (cases.length === 0) return ["fixture has no cases"];

  const problems = [];
  const seen = new Set();
  for (const testCase of cases) {
    const local = [];
    if (seen.has(testCase.id)) local.push("duplicate id");
    seen.add(testCase.id);
    if (!["en", "es"].includes(testCase.lang)) local.push(`unknown lang "${testCase.lang}"`);
    if (!DIFFICULTIES.has(testCase.difficulty)) local.push(`unknown difficulty "${testCase.difficulty}"`);
    local.push(...messageProblems(testCase));
    local.push(...labelProblems(testCase, "spokes", spokesIds));
    local.push(...labelProblems(testCase, "national", nationalNames));
    problems.push(...local.map((problem) => `${testCase.id}: ${problem}`));
  }
  return [...problems, ...pairProblems(cases)];
}
