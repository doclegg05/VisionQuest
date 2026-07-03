#!/usr/bin/env node

/**
 * Summarize real (and estimated) LLM token usage from LlmCallLog.
 *
 * Read-only. Reports per-callSite call counts, input/output token
 * distributions (sum/mean/p50/p95), the provider-vs-estimated split, and an
 * optional cost column when --price-per-mtok is supplied.
 *
 * Usage:
 *   node scripts/sage-usage-summary.mjs
 *   node scripts/sage-usage-summary.mjs --since=24h
 *   node scripts/sage-usage-summary.mjs --since=30d --json
 *   node scripts/sage-usage-summary.mjs --price-per-mtok=0.30
 *   node scripts/sage-usage-summary.mjs --out=.planning/sage-usage/summary.json
 */

import { PrismaClient } from "@prisma/client";
import { ensureParentDir, loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";
import { writeFileSync } from "node:fs";

loadEnvFile();

const args = parseArgs();
const prisma = new PrismaClient();

const SINCE_PATTERN = /^(\d+)(h|d)$/i;

function parseSince(value) {
  if (!value) return 7 * 24 * 60 * 60 * 1000;
  const match = SINCE_PATTERN.exec(String(value).trim());
  if (!match) {
    throw new Error(`Invalid --since value "${value}" — expected e.g. "24h" or "7d"`);
  }
  const amount = Number.parseInt(match[1], 10);
  const unitMs = match[2].toLowerCase() === "h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return amount * unitMs;
}

function pct(part, total) {
  if (!total) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

/** Nearest-rank percentile over a pre-sorted ascending numeric array. */
function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil((p / 100) * sortedValues.length) - 1,
  );
  return sortedValues[Math.max(0, index)];
}

function summarizeTokens(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    sum,
    mean: sorted.length ? sum / sorted.length : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

async function main() {
  const sinceMs = parseSince(args.since);
  const since = new Date(Date.now() - sinceMs);
  const pricePerMtok = args["price-per-mtok"] !== undefined
    ? Number.parseFloat(args["price-per-mtok"])
    : null;
  if (pricePerMtok !== null && !Number.isFinite(pricePerMtok)) {
    throw new Error(`Invalid --price-per-mtok value "${args["price-per-mtok"]}"`);
  }

  const rows = await prisma.llmCallLog.findMany({
    where: { createdAt: { gte: since } },
    select: {
      callSite: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      totalTokens: true,
      durationMs: true,
      createdAt: true,
    },
  });

  const byCallSite = new Map();
  for (const row of rows) {
    const key = row.callSite;
    if (!byCallSite.has(key)) byCallSite.set(key, []);
    byCallSite.get(key).push(row);
  }

  // "provider" vs "estimated" isn't stored on LlmCallLog directly (the
  // column only carries token counts) — this script summarizes what's on
  // the row today. Providers wired via withUsageLogging/onUsage now log
  // real counts when the SDK/API supplies them; older side-channel writers
  // (embeddings.ts, memory/extract.ts) still log char/4 estimates. There is
  // no per-row "source" flag yet, so the split column reports "n/a" until a
  // future migration adds one — see REPORT deviation notes.
  const callSiteRows = [...byCallSite.entries()]
    .map(([callSite, callRows]) => {
      const input = summarizeTokens(callRows.map((r) => r.inputTokens));
      const output = summarizeTokens(callRows.map((r) => r.outputTokens));
      const totalTokens = callRows.reduce((acc, r) => acc + r.totalTokens, 0);
      return {
        callSite,
        calls: callRows.length,
        models: [...new Set(callRows.map((r) => r.model))].sort(),
        inputTokens: input,
        outputTokens: output,
        totalTokens,
        costUsd: pricePerMtok !== null ? (totalTokens / 1_000_000) * pricePerMtok : null,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const totals = {
    calls: rows.length,
    totalTokens: rows.reduce((acc, r) => acc + r.totalTokens, 0),
    inputTokens: rows.reduce((acc, r) => acc + r.inputTokens, 0),
    outputTokens: rows.reduce((acc, r) => acc + r.outputTokens, 0),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    since: since.toISOString(),
    sinceWindow: args.since ?? "7d",
    pricePerMtok,
    totals: {
      ...totals,
      costUsd: pricePerMtok !== null ? (totals.totalTokens / 1_000_000) * pricePerMtok : null,
    },
    byCallSite: callSiteRows,
  };

  if (args.out) {
    ensureParentDir(args.out);
    writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("\nVisionQuest Sage Usage Summary");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Window: since ${report.since} (${report.sinceWindow})`);
  console.log(`Total calls: ${totals.calls}`);
  console.log(`Total tokens: ${totals.totalTokens} (input ${totals.inputTokens} / output ${totals.outputTokens})`);
  if (pricePerMtok !== null) {
    console.log(`Estimated cost: $${report.totals.costUsd.toFixed(4)} @ $${pricePerMtok}/Mtok`);
  }

  console.log("\nBy call site:");
  for (const row of callSiteRows) {
    console.log(`  ${row.callSite} — ${row.calls} calls (${pct(row.calls, totals.calls)}), models: ${row.models.join(", ")}`);
    console.log(
      `    input tokens  sum=${row.inputTokens.sum} mean=${row.inputTokens.mean.toFixed(1)} p50=${row.inputTokens.p50} p95=${row.inputTokens.p95}`,
    );
    console.log(
      `    output tokens sum=${row.outputTokens.sum} mean=${row.outputTokens.mean.toFixed(1)} p50=${row.outputTokens.p50} p95=${row.outputTokens.p95}`,
    );
    if (row.costUsd !== null) {
      console.log(`    est. cost: $${row.costUsd.toFixed(4)}`);
    }
  }

  if (args.out) {
    console.log(`\nWrote JSON report: ${args.out}`);
  }
}

main()
  .catch((error) => {
    console.error("Usage summary failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
