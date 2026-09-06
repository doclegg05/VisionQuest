#!/usr/bin/env node

/**
 * AI accountability report: closes three trust gaps a completeness review
 * found in VisionQuest's AI routing/cost/key-origin story.
 *
 *   (a) PROVIDER MIX BY SENSITIVITY — is FERPA-sensitive chat actually
 *       staying local? `AiAuditEvent` has no dedicated Prisma model: every
 *       row lives in `AuditLog` with `targetType: "ai_request"` (written by
 *       `logAiAuditEvent` in src/lib/ai/audit.ts) and its structured fields
 *       (sensitivity, providerClass, status, ...) are packed into the
 *       `metadata` TEXT column as a JSON string — this script is the first
 *       reader of that column; every writer (chat/send, chat/upload,
 *       resume/assist, resume/upload, post-response, conversation.ts) had
 *       zero consumers before this.
 *   (b) COST — LlmCallLog carries real tokens per call
 *       (src/lib/llm-usage.ts) but nothing aggregates or alarms on it. This
 *       section rolls tokens up by model/callSite, projects a monthly run
 *       rate, and turns it into a dollar figure ONLY when a price is
 *       configured — see config/sage-budget.json.
 *   (c) KEY SOURCE — resolveApiKey() (src/lib/chat/api-key.ts:17-30) checks
 *       a student's personal Gemini key before the platform key, which
 *       routes PII-bearing chat under a personal Google account outside
 *       program terms/audit/cost accounting. Neither LlmCallLog nor the
 *       AiAuditEvent metadata records which branch fired for any call, so
 *       this section reports that as a named measurement gap (with a
 *       same-script proxy metric and a proposed, not-implemented, follow-up)
 *       rather than fabricating a split.
 *
 * Read-only. No student ids, names, or message content are selected or
 * printed anywhere in this script — see .claude/skills/student-data-privacy.
 *
 * Usage:
 *   node scripts/sage-ai-accountability.mjs
 *   node scripts/sage-ai-accountability.mjs --since=7d
 *   node scripts/sage-ai-accountability.mjs --since=30d --json
 *   node scripts/sage-ai-accountability.mjs --budget=500
 *   node scripts/sage-ai-accountability.mjs --price-per-mtok=0.30
 *   node scripts/sage-ai-accountability.mjs --out=.planning/sage-accountability/report.json
 *   node scripts/sage-ai-accountability.mjs --budget-config=config/sage-budget.json
 */

import { PrismaClient } from "@prisma/client";
import { ensureParentDir, loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

loadEnvFile();

const args = parseArgs();
const prisma = new PrismaClient();

const SINCE_PATTERN = /^(\d+)(h|d)$/i;
export const DEFAULT_BUDGET_CONFIG_PATH = fileURLToPath(new URL("../config/sage-budget.json", import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;

// Mirrors DataSensitivity in src/lib/ai/types.ts. Kept as a literal here
// (same pattern as SAFE_STUDENT_CATEGORIES in ./lib/sage-rag-utils.mjs)
// rather than importing the TS module, so every known sensitivity class
// prints a row even when it had zero events in the window.
export const ALL_SENSITIVITIES = ["configured", "student_record", "staff_entered", "public_program", "system"];

// Mirrors isLocalOnlySensitivity() in src/lib/ai/provider.ts.
export const LOCAL_ONLY_SENSITIVITIES = ["student_record", "staff_entered"];

const PROVIDER_CLASSES = ["local", "cloud", "unknown", "none"];

export function parseSince(value) {
  if (!value) return 30 * DAY_MS;
  const match = SINCE_PATTERN.exec(String(value).trim());
  if (!match) {
    throw new Error(`Invalid --since value "${value}" — expected e.g. "24h" or "30d"`);
  }
  const amount = Number.parseInt(match[1], 10);
  const unitMs = match[2].toLowerCase() === "h" ? 60 * 60 * 1000 : DAY_MS;
  return amount * unitMs;
}

function pct(part, total) {
  if (!total) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

export function loadBudgetConfig(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

/** Best-effort JSON parse of an AuditLog.metadata TEXT column. Never throws. */
function parseAuditMetadata(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// ─── (a) Provider mix by sensitivity ────────────────────────────────────────

export function buildProviderMix(auditRows, liveAiProvider) {
  // Keyed by sensitivity -> { completed: {local,cloud,unknown,none}, other: {routed,blocked,failed,direct} }
  const bySensitivity = new Map(
    ALL_SENSITIVITIES.map((s) => [
      s,
      {
        sensitivity: s,
        completed: { local: 0, cloud: 0, unknown: 0, none: 0, total: 0 },
        other: { routed: 0, blocked: 0, failed: 0, direct: 0 },
      },
    ]),
  );
  let unknownSensitivityCount = 0;

  for (const row of auditRows) {
    const meta = parseAuditMetadata(row.metadata);
    const sensitivity = ALL_SENSITIVITIES.includes(meta.sensitivity) ? meta.sensitivity : null;
    if (!sensitivity) {
      unknownSensitivityCount += 1;
      continue;
    }
    const bucket = bySensitivity.get(sensitivity);
    if (meta.status === "completed") {
      const providerClass = PROVIDER_CLASSES.includes(meta.providerClass) ? meta.providerClass : "unknown";
      bucket.completed[providerClass] += 1;
      bucket.completed.total += 1;
    } else if (meta.status === "routed" || meta.status === "blocked" || meta.status === "failed" || meta.status === "direct") {
      bucket.other[meta.status] += 1;
    }
  }

  const rows = [...bySensitivity.values()];

  // Flag: any local-only-by-policy sensitivity that actually completed a
  // call on a cloud provider. This is what src/lib/ai/provider.ts:119-135
  // documents as the alpha flip — every one of these calls is already
  // recorded, but nothing else surfaces it.
  const flags = rows
    .filter((r) => LOCAL_ONLY_SENSITIVITIES.includes(r.sensitivity) && r.completed.cloud > 0)
    .map((r) => ({
      sensitivity: r.sensitivity,
      cloudCompleted: r.completed.cloud,
      totalCompleted: r.completed.total,
      pctOfCompleted: pct(r.completed.cloud, r.completed.total),
    }));

  return { liveAiProvider, rows, flags, unknownSensitivityCount, totalAuditRows: auditRows.length };
}

// ─── (b) Cost ────────────────────────────────────────────────────────────────

/**
 * Resolve a {input, output} $/Mtok price for a model.
 * - `--price-per-mtok` (a flat number) overrides everything, applied to
 *   both input and output tokens uniformly, for a quick one-off estimate.
 * - Otherwise looks up `pricePerMtok[model]` in the budget config: either a
 *   flat number, or an {input, output} object when the provider prices
 *   input/output tokens differently.
 * - Returns null (unpriced) when neither source covers this model — the
 *   caller must not guess.
 */
export function resolveModelPrice(model, priceFlag, configPriceMap) {
  if (priceFlag !== null) {
    return { input: priceFlag, output: priceFlag, source: "flag" };
  }
  const entry = configPriceMap?.[model];
  if (entry === undefined || entry === null) return null;
  if (typeof entry === "number" && Number.isFinite(entry)) {
    return { input: entry, output: entry, source: "config" };
  }
  if (typeof entry === "object" && Number.isFinite(entry.input) && Number.isFinite(entry.output)) {
    return { input: entry.input, output: entry.output, source: "config" };
  }
  return null;
}

export function costUsd(inputTokens, outputTokens, price) {
  if (!price) return null;
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}

export function buildCostReport(llmRows, windowDays, priceFlag, budgetConfig, budgetFlag) {
  const monthlyMultiplier = 30 / Math.max(windowDays, 1 / 24);

  const byModel = new Map();
  const byCallSite = new Map();
  for (const row of llmRows) {
    if (!byModel.has(row.model)) {
      byModel.set(row.model, { model: row.model, callSites: new Set(), calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    }
    const m = byModel.get(row.model);
    m.callSites.add(row.callSite);
    m.calls += 1;
    m.inputTokens += row.inputTokens;
    m.outputTokens += row.outputTokens;
    m.totalTokens += row.totalTokens;

    if (!byCallSite.has(row.callSite)) {
      byCallSite.set(row.callSite, { callSite: row.callSite, models: new Set(), calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    }
    const c = byCallSite.get(row.callSite);
    c.models.add(row.model);
    c.calls += 1;
    c.inputTokens += row.inputTokens;
    c.outputTokens += row.outputTokens;
    c.totalTokens += row.totalTokens;
  }

  const configPriceMap = budgetConfig.pricePerMtok ?? {};

  const modelRows = [...byModel.values()]
    .map((m) => {
      const price = resolveModelPrice(m.model, priceFlag, configPriceMap);
      const windowCost = costUsd(m.inputTokens, m.outputTokens, price);
      return {
        model: m.model,
        callSites: [...m.callSites].sort(),
        calls: m.calls,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        totalTokens: m.totalTokens,
        monthlyRunRateTokens: Math.round(m.totalTokens * monthlyMultiplier),
        pricingSource: price?.source ?? null,
        costWindowUsd: windowCost,
        costMonthlyUsd: windowCost === null ? null : windowCost * monthlyMultiplier,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  // callSite rows can span multiple models with different (or missing)
  // prices, so cost per callSite is the sum of only the priced models in
  // it — a callSite with any unpriced model gets a null cost rather than a
  // partial number silently presented as complete.
  const callSiteRows = [...byCallSite.values()]
    .map((c) => {
      const modelsInSite = [...c.models];
      const prices = modelsInSite.map((model) => resolveModelPrice(model, priceFlag, configPriceMap));
      const fullyPriced = prices.every((p) => p !== null);
      let windowCost = null;
      if (fullyPriced) {
        windowCost = llmRows
          .filter((r) => r.callSite === c.callSite)
          .reduce((sum, r) => {
            const price = resolveModelPrice(r.model, priceFlag, configPriceMap);
            return sum + (costUsd(r.inputTokens, r.outputTokens, price) ?? 0);
          }, 0);
      }
      return {
        callSite: c.callSite,
        models: modelsInSite.sort(),
        calls: c.calls,
        totalTokens: c.totalTokens,
        monthlyRunRateTokens: Math.round(c.totalTokens * monthlyMultiplier),
        costWindowUsd: windowCost,
        costMonthlyUsd: windowCost === null ? null : windowCost * monthlyMultiplier,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const totalTokens = llmRows.reduce((sum, r) => sum + r.totalTokens, 0);
  const allModelsPriced = modelRows.length > 0 && modelRows.every((m) => m.costWindowUsd !== null);
  const totalWindowCost = allModelsPriced ? modelRows.reduce((sum, m) => sum + m.costWindowUsd, 0) : null;
  const totalMonthlyCost = totalWindowCost === null ? null : totalWindowCost * monthlyMultiplier;

  const budgetUsd = budgetFlag !== null ? budgetFlag : (typeof budgetConfig.monthlyBudgetUsd === "number" ? budgetConfig.monthlyBudgetUsd : null);
  const budgetSource = budgetFlag !== null ? "flag" : (budgetUsd !== null ? "config" : "none");

  let budgetCheck;
  if (budgetUsd === null) {
    budgetCheck = {
      status: "no_budget",
      message: "No monthly budget configured — nothing to check against. Set --budget=<usd> or config/sage-budget.json.monthlyBudgetUsd (see its notes.monthlyBudgetUsd for why it ships unset).",
    };
  } else if (totalMonthlyCost === null) {
    budgetCheck = {
      status: "no_price",
      message: `Budget of $${budgetUsd.toFixed(2)}/mo (${budgetSource}) is set but at least one model in this window has no configured price — cannot compute a total cost projection to check against it. Supply --price-per-mtok=<usd> or fill in config/sage-budget.json.pricePerMtok for every model listed above.`,
    };
  } else if (totalMonthlyCost > budgetUsd) {
    budgetCheck = {
      status: "warning",
      message: `BUDGET WARNING: projected monthly cost $${totalMonthlyCost.toFixed(2)} exceeds the $${budgetUsd.toFixed(2)}/mo budget (${budgetSource}).`,
    };
  } else {
    budgetCheck = {
      status: "ok",
      message: `Projected monthly cost $${totalMonthlyCost.toFixed(2)} is within the $${budgetUsd.toFixed(2)}/mo budget (${budgetSource}).`,
    };
  }

  return {
    windowDays,
    monthlyMultiplier,
    shortWindowCaveat: windowDays < 1
      ? "Window is under 1 day — the monthly projection is extrapolated from a very small sample and is rough."
      : null,
    byModel: modelRows,
    byCallSite: callSiteRows,
    totals: {
      calls: llmRows.length,
      totalTokens,
      monthlyRunRateTokens: Math.round(totalTokens * monthlyMultiplier),
      costWindowUsd: totalWindowCost,
      costMonthlyUsd: totalMonthlyCost,
    },
    budgetUsd,
    budgetSource,
    budgetCheck,
  };
}

// ─── (c) Key source ──────────────────────────────────────────────────────────

async function buildKeySourceReport() {
  const [studentsTotal, studentsWithPersonalKey] = await Promise.all([
    prisma.student.count(),
    prisma.student.count({ where: { geminiApiKey: { not: null } } }),
  ]);

  return {
    measurementGap: true,
    reason:
      "Key origin (per-student personal Gemini key vs admin platform key vs GEMINI_API_KEY env fallback) is not recorded anywhere in the data model. resolveApiKey() in src/lib/chat/api-key.ts:17-30 resolves in that priority order but returns only the resolved key string — callers (and everything they log) never learn which branch fired.",
    checkedFields: {
      llmCallLog: ["studentId", "callSite", "model", "inputTokens", "outputTokens", "totalTokens", "durationMs", "promptRevision", "createdAt"],
      aiAuditEventMetadata: ["route", "task", "sensitivity", "policyDecision", "status", "providerName", "providerClass", "promptTier", "promptRevision", "allowCloud", "cloudBlocked", "inputChars", "outputChars", "reason", "errorCode", "contentLogged", "piiLogged"],
    },
    note: "Neither list has a key-source field, confirmed by reading src/lib/ai/audit.ts (AiAuditEventInput) and prisma/schema.prisma (model LlmCallLog) directly — this is not an absence-of-evidence guess.",
    proxy: {
      studentsTotal,
      studentsWithPersonalKey,
      caveat:
        "This is a snapshot of who COULD route under a personal key today (Student.geminiApiKey IS NOT NULL), per resolveApiKey's personal-key-first precedence — an aggregate count, no student identifiers. It is not a call-level measure: it says nothing about how many calls in the reporting window actually used a personal key versus the platform key.",
    },
    proposedFollowUp:
      "Have resolveApiKey() return { key, source: \"personal\" | \"platform\" | \"env\" } instead of a bare string, then thread `source` into logAiAuditEvent()'s metadata (e.g. a new keySource field — metadata is a JSON blob, so this is additive, no migration) at every call site: src/app/api/chat/send/route.ts, chat/upload/route.ts, resume/assist/route.ts, resume/upload/route.ts, src/lib/chat/post-response.ts, src/lib/chat/conversation.ts. Proposed here, not implemented by this script.",
  };
}

// ─── Report ──────────────────────────────────────────────────────────────────

async function main() {
  const sinceMs = parseSince(args.since);
  const since = new Date(Date.now() - sinceMs);
  const windowDays = sinceMs / DAY_MS;

  const priceFlag = args["price-per-mtok"] !== undefined ? Number.parseFloat(args["price-per-mtok"]) : null;
  if (priceFlag !== null && !Number.isFinite(priceFlag)) {
    throw new Error(`Invalid --price-per-mtok value "${args["price-per-mtok"]}"`);
  }
  const budgetFlag = args.budget !== undefined ? Number.parseFloat(args.budget) : null;
  if (budgetFlag !== null && !Number.isFinite(budgetFlag)) {
    throw new Error(`Invalid --budget value "${args.budget}"`);
  }

  const budgetConfigPath = args["budget-config"] ?? DEFAULT_BUDGET_CONFIG_PATH;
  const budgetConfig = loadBudgetConfig(budgetConfigPath);

  const [auditRows, llmRows, aiProviderConfig] = await Promise.all([
    prisma.auditLog.findMany({
      where: { targetType: "ai_request", createdAt: { gte: since } },
      select: { metadata: true, createdAt: true },
    }),
    prisma.llmCallLog.findMany({
      where: { createdAt: { gte: since } },
      select: { callSite: true, model: true, inputTokens: true, outputTokens: true, totalTokens: true, createdAt: true },
    }),
    prisma.systemConfig.findUnique({ where: { key: "ai_provider" }, select: { value: true } }),
  ]);

  const providerMix = buildProviderMix(auditRows, aiProviderConfig?.value ?? null);
  const cost = buildCostReport(llmRows, windowDays, priceFlag, budgetConfig, budgetFlag);
  const keySource = await buildKeySourceReport();

  const report = {
    generatedAt: new Date().toISOString(),
    since: since.toISOString(),
    sinceWindow: args.since ?? "30d",
    budgetConfigPath: String(budgetConfigPath),
    providerMix,
    cost,
    keySource,
  };

  if (args.out) {
    ensureParentDir(args.out);
    writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("\nVisionQuest Sage AI Accountability Report");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Window: since ${report.since} (${report.sinceWindow})`);
  console.log(`Budget config: ${report.budgetConfigPath}`);

  console.log("\n=== (a) PROVIDER MIX BY SENSITIVITY ===");
  console.log(`Live routing config: SystemConfig.ai_provider = ${providerMix.liveAiProvider ? `"${providerMix.liveAiProvider}"` : "(unset)"}`);
  console.log(`Local-only-by-policy sensitivities (src/lib/ai/provider.ts): ${LOCAL_ONLY_SENSITIVITIES.join(", ")}`);
  console.log(`AiAuditEvent rows in window: ${providerMix.totalAuditRows} (AuditLog rows with targetType="ai_request")`);
  if (providerMix.unknownSensitivityCount > 0) {
    console.log(`  ${providerMix.unknownSensitivityCount} row(s) had an unrecognized or missing sensitivity value — excluded from the table below.`);
  }
  if (providerMix.totalAuditRows === 0) {
    console.log("  No AiAuditEvent rows in this window — nothing to break down. Try a wider --since.");
  } else {
    for (const row of providerMix.rows) {
      const hasAny = row.completed.total > 0 || Object.values(row.other).some((n) => n > 0);
      if (!hasAny) {
        console.log(`  ${row.sensitivity}: 0 events`);
        continue;
      }
      console.log(`  ${row.sensitivity} — ${row.completed.total} completed call(s)`);
      if (row.completed.total > 0) {
        for (const cls of PROVIDER_CLASSES) {
          if (row.completed[cls] === 0) continue;
          console.log(`    ${cls}: ${row.completed[cls]} (${pct(row.completed[cls], row.completed.total)})`);
        }
      }
      const otherParts = Object.entries(row.other).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`);
      if (otherParts.length > 0) {
        console.log(`    non-completed: ${otherParts.join(" ")}`);
      }
    }
  }

  console.log("\n  FLAGS:");
  if (providerMix.flags.length === 0) {
    console.log("    No FERPA routing flags — every local-only-by-policy sensitivity that completed a call stayed on a local provider in this window.");
  } else {
    for (const flag of providerMix.flags) {
      console.log(
        `    >>> FERPA ROUTING FLAG: "${flag.sensitivity}" completed ${flag.cloudCompleted} of ${flag.totalCompleted} call(s) (${flag.pctOfCompleted}) on a CLOUD provider despite being local-only-by-policy. This is the documented alpha flip in src/lib/ai/provider.ts:119-135 (SystemConfig.ai_provider != "local") — every call is recorded here, but this report is the first thing that surfaces it.`,
      );
    }
  }

  console.log("\n=== (b) COST ===");
  console.log(`Window: ${cost.windowDays.toFixed(2)} day(s) -> monthly projection multiplier x${cost.monthlyMultiplier.toFixed(2)}`);
  if (cost.shortWindowCaveat) console.log(`  ${cost.shortWindowCaveat}`);
  if (llmRows.length === 0) {
    console.log("  No LlmCallLog rows in this window — nothing to roll up. Try a wider --since.");
  } else {
    console.log("\n  By model:");
    for (const m of cost.byModel) {
      console.log(`    ${m.model} — ${m.calls} call(s), callSites: ${m.callSites.join(", ")}`);
      console.log(`      tokens: input=${m.inputTokens} output=${m.outputTokens} total=${m.totalTokens}`);
      console.log(`      monthly run-rate (tokens): ~${m.monthlyRunRateTokens}/mo`);
      if (m.costWindowUsd === null) {
        console.log(`      cost: n/a (no price configured for model "${m.model}" — see config/sage-budget.json or pass --price-per-mtok)`);
      } else {
        console.log(`      cost (window): $${m.costWindowUsd.toFixed(4)} [${m.pricingSource}]  cost (monthly projected): $${m.costMonthlyUsd.toFixed(4)}`);
      }
    }

    console.log("\n  By call site:");
    for (const c of cost.byCallSite) {
      console.log(`    ${c.callSite} — ${c.calls} call(s), models: ${c.models.join(", ")}, total tokens: ${c.totalTokens} (monthly run-rate ~${c.monthlyRunRateTokens}/mo)`);
      console.log(c.costWindowUsd === null
        ? "      cost: n/a (at least one model in this call site is unpriced)"
        : `      cost (window): $${c.costWindowUsd.toFixed(4)}  cost (monthly projected): $${c.costMonthlyUsd.toFixed(4)}`);
    }

    console.log("\n  Totals:");
    console.log(`    calls=${cost.totals.calls} tokens=${cost.totals.totalTokens} monthly run-rate=~${cost.totals.monthlyRunRateTokens}/mo`);
    console.log(cost.totals.costWindowUsd === null
      ? "    cost: n/a (at least one model in this window is unpriced)"
      : `    cost (window): $${cost.totals.costWindowUsd.toFixed(4)}  cost (monthly projected): $${cost.totals.costMonthlyUsd.toFixed(4)}`);
  }

  console.log("\n  Budget check:");
  console.log(`    ${cost.budgetCheck.message}`);

  console.log("\n=== (c) KEY SOURCE ===");
  console.log("  MEASUREMENT GAP: key origin (personal Gemini key vs platform key vs env fallback) is not recorded anywhere in the data model.");
  console.log(`    ${keySource.reason}`);
  console.log(`    Checked fields — LlmCallLog: ${keySource.checkedFields.llmCallLog.join(", ")}`);
  console.log(`    Checked fields — AiAuditEvent metadata: ${keySource.checkedFields.aiAuditEventMetadata.join(", ")}`);
  console.log("    This report will not fabricate a personal/platform split — any percentage here would be invented.");
  console.log("\n  Proxy (not a call-level measure):");
  console.log(`    ${keySource.proxy.studentsWithPersonalKey} of ${keySource.proxy.studentsTotal} student(s) currently have a personal Gemini API key configured.`);
  console.log(`    Caveat: ${keySource.proxy.caveat}`);
  console.log("\n  Proposed follow-up (not implemented by this script):");
  console.log(`    ${keySource.proposedFollowUp}`);

  if (args.out) {
    console.log(`\nWrote JSON report: ${args.out}`);
  }
}

// Only auto-run when executed directly — importing this module for its pure
// report-building functions (the benchmark suite's cost-per-student and
// ferpa-routing scorers) must never start a live report run against the
// default DATABASE_URL, since those scorers connect to their own
// prod-readonly URL instead.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main()
    .catch((error) => {
      console.error("AI accountability report failed:", error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
