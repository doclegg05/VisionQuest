#!/usr/bin/env node

/**
 * Summarize real (and estimated) LLM token usage from LlmCallLog.
 *
 * Read-only. Reports per-callSite call counts, input/output token
 * distributions (sum/mean/p50/p95), duration distributions (p50/p95/max) per
 * callSite and per model within it, the provider-vs-estimated split, and an
 * optional cost column when --price-per-mtok is supplied. Duration rows are
 * checked against config/sage-slo.json and any p95 over its bar prints a
 * clearly-marked "SLO BREACH" line — see docs/SLO.md.
 *
 * Usage:
 *   node scripts/sage-usage-summary.mjs
 *   node scripts/sage-usage-summary.mjs --since=24h
 *   node scripts/sage-usage-summary.mjs --since=30d --json
 *   node scripts/sage-usage-summary.mjs --price-per-mtok=0.30
 *   node scripts/sage-usage-summary.mjs --out=.planning/sage-usage/summary.json
 *   node scripts/sage-usage-summary.mjs --slo-config=config/sage-slo.json
 *   node scripts/sage-usage-summary.mjs --dry-run   # synthetic rows, no DB — see docs/SLO.md
 */

import { PrismaClient } from "@prisma/client";
import { ensureParentDir, loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

loadEnvFile();

const args = parseArgs();
const prisma = new PrismaClient();

const SINCE_PATTERN = /^(\d+)(h|d)$/i;
const DEFAULT_SLO_CONFIG_PATH = fileURLToPath(new URL("../config/sage-slo.json", import.meta.url));

/**
 * Synthetic LlmCallLog-shaped rows for `--dry-run`. Used to preview the
 * report shape and prove the SLO breach check fires/doesn't fire without a
 * live DB connection. Never written to the database. One row (the third
 * sage_chat/gemini call, 7000ms) deliberately exceeds the default 6000ms
 * cloud-chat bar so a plain `--dry-run` run shows one real breach alongside
 * compliant rows — see docs/SLO.md for the full verification walkthrough.
 */
const DRY_RUN_ROWS = [
  { callSite: "sage_chat", model: "gemini", inputTokens: 800, outputTokens: 220, totalTokens: 1020, durationMs: 1283, createdAt: new Date() },
  { callSite: "sage_chat", model: "gemini", inputTokens: 900, outputTokens: 240, totalTokens: 1140, durationMs: 1816, createdAt: new Date() },
  { callSite: "sage_chat", model: "gemini", inputTokens: 1200, outputTokens: 300, totalTokens: 1500, durationMs: 7000, createdAt: new Date() },
  { callSite: "sage_chat", model: "ollama", inputTokens: 800, outputTokens: 220, totalTokens: 1020, durationMs: 45000, createdAt: new Date() },
  { callSite: "sage_chat", model: "ollama", inputTokens: 850, outputTokens: 230, totalTokens: 1080, durationMs: 68000, createdAt: new Date() },
  { callSite: "sage_post.goals", model: "gemini", inputTokens: 400, outputTokens: 100, totalTokens: 500, durationMs: 2200, createdAt: new Date() },
  { callSite: "sage_post.mood", model: "gemini", inputTokens: 300, outputTokens: 80, totalTokens: 380, durationMs: 1900, createdAt: new Date() },
];

function loadSloConfig(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

/** Look up the p95 bar (ms) for a callSite/model pair, falling back to defaultP95Ms. */
function getSloBarMs(callSite, model, sloConfig) {
  const perModel = sloConfig.perProviderP95Ms?.[callSite];
  if (perModel && Object.prototype.hasOwnProperty.call(perModel, model)) {
    return perModel[model];
  }
  return sloConfig.defaultP95Ms;
}

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

/**
 * durationMs is nullable on LlmCallLog (rows written before duration
 * tracking, or a provider call that errored before completion), so `count`
 * here is the number of rows that actually carried a duration — it can be
 * less than the row/call count for the same callSite.
 */
function summarizeDuration(values) {
  const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    mean: sorted.length ? sum / sorted.length : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
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

  const sloConfigPath = args["slo-config"] ?? DEFAULT_SLO_CONFIG_PATH;
  const sloConfig = loadSloConfig(sloConfigPath);

  const dryRun = Boolean(args["dry-run"]);
  const rows = dryRun
    ? DRY_RUN_ROWS
    : await prisma.llmCallLog.findMany({
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
  const sloBreaches = [];

  const callSiteRows = [...byCallSite.entries()]
    .map(([callSite, callRows]) => {
      const input = summarizeTokens(callRows.map((r) => r.inputTokens));
      const output = summarizeTokens(callRows.map((r) => r.outputTokens));
      const totalTokens = callRows.reduce((acc, r) => acc + r.totalTokens, 0);
      const durationMs = summarizeDuration(callRows.map((r) => r.durationMs));

      const models = [...new Set(callRows.map((r) => r.model))].sort();
      const byModel = models.map((model) => {
        const modelRows = callRows.filter((r) => r.model === model);
        const modelDuration = summarizeDuration(modelRows.map((r) => r.durationMs));
        const sloP95BarMs = getSloBarMs(callSite, model, sloConfig);
        const breached = modelDuration.count > 0 && modelDuration.p95 > sloP95BarMs;
        if (breached) {
          sloBreaches.push({ callSite, model, p95: modelDuration.p95, sloP95BarMs });
        }
        return {
          model,
          calls: modelRows.length,
          durationMs: modelDuration,
          sloP95BarMs,
          breached,
        };
      });

      return {
        callSite,
        calls: callRows.length,
        models,
        inputTokens: input,
        outputTokens: output,
        totalTokens,
        durationMs,
        byModel,
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
    dryRun,
    totals: {
      ...totals,
      costUsd: pricePerMtok !== null ? (totals.totalTokens / 1_000_000) * pricePerMtok : null,
    },
    byCallSite: callSiteRows,
    slo: {
      configPath: String(sloConfigPath),
      breaches: sloBreaches,
    },
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
  if (dryRun) {
    console.log("DRY RUN: synthetic rows, no database query was made — see docs/SLO.md");
  }
  console.log(`SLO config: ${sloConfigPath}`);
  console.log(`Total calls: ${totals.calls}`);
  console.log(`Total tokens: ${totals.totalTokens} (input ${totals.inputTokens} / output ${totals.outputTokens})`);
  if (pricePerMtok !== null) {
    console.log(`Estimated cost: $${report.totals.costUsd.toFixed(4)} @ $${pricePerMtok}/Mtok`);
  }

  if (totals.calls === 0) {
    console.log("\nNo LlmCallLog rows in this window — nothing to summarize. Try a wider --since.");
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
    if (row.durationMs.count > 0) {
      console.log(
        `    duration ms   n=${row.durationMs.count} mean=${row.durationMs.mean.toFixed(1)} p50=${row.durationMs.p50} p95=${row.durationMs.p95} max=${row.durationMs.max}`,
      );
    } else {
      console.log("    duration ms   n=0 (no rows in this window carry a recorded duration)");
    }
    for (const modelRow of row.byModel) {
      if (modelRow.durationMs.count === 0) {
        console.log(`      ${modelRow.model}: n=0 duration rows, SLO p95 bar ${modelRow.sloP95BarMs}ms — nothing to check`);
        continue;
      }
      const status = modelRow.breached ? "SLO BREACH" : "ok";
      console.log(
        `      ${modelRow.model}: n=${modelRow.durationMs.count} p50=${modelRow.durationMs.p50} p95=${modelRow.durationMs.p95} max=${modelRow.durationMs.max} (bar ${modelRow.sloP95BarMs}ms) [${status}]`,
      );
      if (modelRow.breached) {
        console.log(
          `      >>> SLO BREACH: ${row.callSite}/${modelRow.model} p95=${modelRow.durationMs.p95}ms exceeds the ${modelRow.sloP95BarMs}ms bar`,
        );
      }
    }
    if (row.costUsd !== null) {
      console.log(`    est. cost: $${row.costUsd.toFixed(4)}`);
    }
  }

  console.log("\nSLO check:");
  if (sloBreaches.length === 0) {
    console.log("  No SLO breaches — every callSite/model p95 is within its bar.");
  } else {
    console.log(`  ${sloBreaches.length} SLO BREACH(es):`);
    for (const breach of sloBreaches) {
      console.log(
        `    SLO BREACH: ${breach.callSite}/${breach.model} p95=${breach.p95}ms > bar ${breach.sloP95BarMs}ms`,
      );
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
