#!/usr/bin/env npx tsx

/**
 * RAG evaluation runner.
 *
 * Usage:
 *   npm run eval:rag              # full eval (all questions)
 *   npm run eval:rag:smoke        # smoke eval (~15 questions)
 *   npm run eval:rag -- --category certification_details
 */

import fs from "node:fs";
import path from "node:path";
import { retrieve } from "../src/lib/rag/retrieve";
import { classifyQuery } from "../src/lib/rag/query-classifier";
import type { QueryType, RetrievalResult } from "../src/lib/rag/types";

// ---------------------------------------------------------------------------
// Gold-set types
// ---------------------------------------------------------------------------

interface GoldQuestion {
  id: string;
  category: string;
  question: string;
  expectedSourceDoc: string;
  expectedAnswer: string;
  expectedQueryType: QueryType;
  role: string;
  priorContext?: { role: string; content: string }[];
}

// ---------------------------------------------------------------------------
// Per-question result
// ---------------------------------------------------------------------------

interface QuestionResult {
  id: string;
  category: string;
  question: string;
  expectedSourceDoc: string;
  expectedQueryType: QueryType;
  actualQueryType: QueryType;
  classificationCorrect: boolean;
  retrievalHit: boolean;
  precisionAt3: boolean;
  fallbackUsed: boolean;
  latencyMs: number;
  topChunks: { title: string; score: number }[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  smoke: boolean;
  category: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let smoke = false;
  let category: string | null = null;

  for (const arg of args) {
    if (arg === "--smoke") {
      smoke = true;
    } else if (arg.startsWith("--category=")) {
      category = arg.split("=")[1] ?? null;
    } else if (arg.startsWith("--category")) {
      // handle --category X (space-separated)
      const idx = args.indexOf(arg);
      if (idx + 1 < args.length) {
        category = args[idx + 1];
      }
    }
  }

  return { smoke, category };
}

// ---------------------------------------------------------------------------
// Evaluate a single question
// ---------------------------------------------------------------------------

async function evaluateQuestion(q: GoldQuestion): Promise<QuestionResult> {
  const actualQueryType = classifyQuery(q.question);
  const classificationCorrect = actualQueryType === q.expectedQueryType;

  const startTime = Date.now();
  let result: RetrievalResult | null = null;
  let error: string | null = null;

  try {
    result = await retrieve(
      q.question,
      "eval-conv",
      q.priorContext ?? [],
      { userId: "eval-user", role: q.role },
    );
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : String(err);
  }

  const latencyMs = Date.now() - startTime;

  const chunks = result?.chunks ?? [];
  const topChunks = chunks.slice(0, 5).map((c) => ({
    title: c.sourceDocTitle,
    score: c.score,
  }));

  const expectedLower = q.expectedSourceDoc.toLowerCase();

  // Retrieval hit: expected source doc appears in ANY returned chunk
  const retrievalHit = chunks.some((c) =>
    c.sourceDocTitle.toLowerCase().includes(expectedLower),
  );

  // Precision@3: expected source in top 3 chunks
  const precisionAt3 = chunks
    .slice(0, 3)
    .some((c) => c.sourceDocTitle.toLowerCase().includes(expectedLower));

  const fallbackUsed = result?.fallbackUsed ?? true;

  return {
    id: q.id,
    category: q.category,
    question: q.question,
    expectedSourceDoc: q.expectedSourceDoc,
    expectedQueryType: q.expectedQueryType,
    actualQueryType,
    classificationCorrect,
    retrievalHit,
    precisionAt3,
    fallbackUsed,
    latencyMs,
    topChunks,
    error,
  };
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function pct(num: number, den: number): string {
  if (den === 0) return "0.0%";
  return `${((num / den) * 100).toFixed(1)}%`;
}

function p95Latency(latencies: number[]): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function generateReport(
  results: QuestionResult[],
  mode: string,
): string {
  const total = results.length;
  const classCorrect = results.filter((r) => r.classificationCorrect).length;
  const hits = results.filter((r) => r.retrievalHit).length;
  const p3 = results.filter((r) => r.precisionAt3).length;
  const fallbacks = results.filter((r) => r.fallbackUsed).length;
  const latencies = results.map((r) => r.latencyMs);
  const avgLatency = total > 0
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / total)
    : 0;
  const p95 = p95Latency(latencies);

  const timestamp = new Date().toISOString();

  const lines: string[] = [];
  lines.push("# RAG Evaluation Report");
  lines.push(`Date: ${timestamp}`);
  lines.push(`Mode: ${mode}`);
  lines.push(`Questions: ${total}`);
  lines.push("");

  // Summary table
  lines.push("## Summary");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Classification accuracy | ${classCorrect}/${total} (${pct(classCorrect, total)}) |`);
  lines.push(`| Retrieval hit rate | ${hits}/${total} (${pct(hits, total)}) |`);
  lines.push(`| Chunk precision@3 | ${p3}/${total} (${pct(p3, total)}) |`);
  lines.push(`| Fallback rate | ${fallbacks}/${total} (${pct(fallbacks, total)}) |`);
  lines.push(`| Avg latency | ${avgLatency}ms |`);
  lines.push(`| p95 latency | ${p95}ms |`);
  lines.push("");

  // Results by category
  const categories = Array.from(new Set(results.map((r) => r.category))).sort();
  lines.push("## Results by Category");
  lines.push("| Category | Hit Rate | Precision@3 | Avg Latency |");
  lines.push("|----------|----------|-------------|-------------|");

  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const catTotal = catResults.length;
    const catHits = catResults.filter((r) => r.retrievalHit).length;
    const catP3 = catResults.filter((r) => r.precisionAt3).length;
    const catLatencies = catResults.map((r) => r.latencyMs);
    const catAvg = catTotal > 0
      ? Math.round(catLatencies.reduce((a, b) => a + b, 0) / catTotal)
      : 0;

    lines.push(
      `| ${cat} | ${catHits}/${catTotal} (${pct(catHits, catTotal)}) | ${catP3}/${catTotal} (${pct(catP3, catTotal)}) | ${catAvg}ms |`,
    );
  }
  lines.push("");

  // Failed questions
  const failed = results.filter((r) => !r.retrievalHit);
  if (failed.length > 0) {
    lines.push("## Failed Questions");
    lines.push("| ID | Question | Expected Source | Got | Score |");
    lines.push("|----|----------|----------------|-----|-------|");
    for (const f of failed) {
      const got = f.topChunks.length > 0
        ? f.topChunks[0].title
        : f.error ?? "(no chunks)";
      const score = f.topChunks.length > 0
        ? f.topChunks[0].score.toFixed(4)
        : "N/A";
      // Truncate question for table readability
      const q = f.question.length > 60
        ? f.question.slice(0, 57) + "..."
        : f.question;
      lines.push(`| ${f.id} | ${q} | ${f.expectedSourceDoc} | ${got} | ${score} |`);
    }
    lines.push("");
  }

  // Errors
  const errored = results.filter((r) => r.error !== null);
  if (errored.length > 0) {
    lines.push("## Errors");
    lines.push("| ID | Error |");
    lines.push("|----|-------|");
    for (const e of errored) {
      lines.push(`| ${e.id} | ${e.error} |`);
    }
    lines.push("");
  }

  // Misclassified questions
  const misclassified = results.filter((r) => !r.classificationCorrect);
  if (misclassified.length > 0) {
    lines.push("## Misclassified Questions");
    lines.push("| ID | Question | Expected Type | Actual Type |");
    lines.push("|----|----------|--------------|-------------|");
    for (const m of misclassified) {
      const q = m.question.length > 60
        ? m.question.slice(0, 57) + "..."
        : m.question;
      lines.push(`| ${m.id} | ${q} | ${m.expectedQueryType} | ${m.actualQueryType} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  // Load gold set
  const goldPath = path.resolve(__dirname, "eval/gold-set.json");
  const raw = fs.readFileSync(goldPath, "utf-8");
  let goldSet: GoldQuestion[] = JSON.parse(raw);

  // Filter by category
  if (args.category) {
    goldSet = goldSet.filter((q) => q.category === args.category);
    if (goldSet.length === 0) {
      console.error(`No questions found for category: ${args.category}`);
      process.exit(1);
    }
  }

  // Smoke mode: first 15 questions
  if (args.smoke) {
    goldSet = goldSet.slice(0, 15);
  }

  // Determine mode label
  let mode = "full";
  if (args.smoke) mode = "smoke";
  if (args.category) mode = `category:${args.category}`;
  if (args.smoke && args.category) mode = `smoke+category:${args.category}`;

  console.log(`\nRunning RAG evaluation (${mode}) — ${goldSet.length} questions\n`);

  // Evaluate each question sequentially to avoid overloading the DB
  const results: QuestionResult[] = [];
  for (let i = 0; i < goldSet.length; i++) {
    const q = goldSet[i];
    const progress = `[${i + 1}/${goldSet.length}]`;

    try {
      const result = await evaluateQuestion(q);
      results.push(result);

      const status = result.retrievalHit ? "HIT" : "MISS";
      const classStatus = result.classificationCorrect ? "" : " (MISCLASSIFIED)";
      console.log(`${progress} ${status} ${q.id}${classStatus} (${result.latencyMs}ms)`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`${progress} ERROR ${q.id}: ${message}`);
      results.push({
        id: q.id,
        category: q.category,
        question: q.question,
        expectedSourceDoc: q.expectedSourceDoc,
        expectedQueryType: q.expectedQueryType,
        actualQueryType: classifyQuery(q.question),
        classificationCorrect: false,
        retrievalHit: false,
        precisionAt3: false,
        fallbackUsed: true,
        latencyMs: 0,
        topChunks: [],
        error: message,
      });
    }
  }

  // Generate report
  const report = generateReport(results, mode);

  // Output to stdout
  console.log("\n" + report);

  // Save to file
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.resolve(__dirname, `eval/results-${ts}.md`);
  fs.writeFileSync(outPath, report, "utf-8");
  console.log(`Report saved to: ${outPath}`);

  // Exit code: 0 if retrieval hit rate > 50%, 1 otherwise
  const hitRate = results.length > 0
    ? results.filter((r) => r.retrievalHit).length / results.length
    : 0;

  if (hitRate > 0.5) {
    console.log(`\nPASS: Hit rate ${(hitRate * 100).toFixed(1)}% > 50% threshold`);
    process.exit(0);
  } else {
    console.log(`\nFAIL: Hit rate ${(hitRate * 100).toFixed(1)}% <= 50% threshold`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
