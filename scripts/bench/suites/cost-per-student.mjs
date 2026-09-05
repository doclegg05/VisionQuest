/**
 * bench suite: cost-per-student (config/benchmarks/cost-per-student.json)
 *
 * Rolls up the trailing 30 days of LlmCallLog/AuditLog the same way
 * `npm run sage:ai:accountability` does — reusing its `buildProviderMix()`
 * and `buildCostReport()` (exported this session, no CLI behavior change;
 * see scripts/sage-ai-accountability.mjs's isMain guard) — but against
 * BENCH_PROD_READONLY_URL rather than the script's own DATABASE_URL
 * default, since a benchmark suite must not depend on which database
 * happens to be configured for whoever runs it.
 *
 * "Active student" = distinct LlmCallLog.studentId with at least one call in
 * the window. This is an aggregate count only: no student id is selected
 * for output, only counted (see .claude/rules/security.md — no PII in logs).
 *
 * usd_per_active_student_month ships without a floor until
 * config/sage-budget.json.monthlyBudgetUsd is set AND every model in the
 * window has a configured price — see that suite's config notes for why the
 * floor cannot be a fixed number in this file. The would-be floor and the
 * accountability report's own budgetCheck verdict are always included in
 * details for a human (or a future runner enhancement) to read.
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import {
  DEFAULT_BUDGET_CONFIG_PATH,
  buildCostReport,
  buildProviderMix,
} from "../../sage-ai-accountability.mjs";
import { isMainModule, runSelfTest } from "./ops-shared.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

/**
 * Pure arithmetic, tested without a database in cost-per-student.test.mjs.
 * usd_per_active_student_month is null (not 0, and not NaN) whenever the
 * numerator is unpriced or there are no active students to divide by — a
 * silent 0 would read as "free", which is a stronger and false claim than
 * "unmeasured". derivedFloor is likewise null until a budget is configured,
 * since dividing by activeStudents=0 is undefined, not infinite headroom.
 *
 * @param {{ costMonthlyUsd: number | null, activeStudents: number, monthlyBudgetUsd: number | null }} input
 * @returns {{ usdPerActiveStudentMonth: number | null, derivedFloor: number | null }}
 */
export function computeCostMetrics({ costMonthlyUsd, activeStudents, monthlyBudgetUsd }) {
  const usdPerActiveStudentMonth =
    costMonthlyUsd === null || activeStudents === 0 ? null : costMonthlyUsd / activeStudents;
  const derivedFloor =
    monthlyBudgetUsd !== null && activeStudents > 0 ? monthlyBudgetUsd / activeStudents : null;
  return { usdPerActiveStudentMonth, derivedFloor };
}

/** @param {object} ctx @returns {Promise<{ metrics: Array<object> }>} */
export async function run(ctx) {
  const url = ctx.env.databaseUrl;
  if (!url) {
    throw new Error("cost-per-student requires prod-readonly: set BENCH_PROD_READONLY_URL.");
  }

  const budgetConfig = JSON.parse(readFileSync(DEFAULT_BUDGET_CONFIG_PATH, "utf8"));
  const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS);
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const [auditRows, llmRows] = await Promise.all([
      prisma.auditLog.findMany({
        where: { targetType: "ai_request", createdAt: { gte: since } },
        select: { metadata: true, createdAt: true },
      }),
      prisma.llmCallLog.findMany({
        where: { createdAt: { gte: since } },
        select: {
          studentId: true,
          callSite: true,
          model: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          createdAt: true,
        },
      }),
    ]);

    const providerMix = buildProviderMix(auditRows, null);
    const cost = buildCostReport(llmRows, WINDOW_DAYS, null, budgetConfig, null);

    const activeStudents = new Set(llmRows.map((row) => row.studentId).filter(Boolean)).size;
    const monthlyBudgetUsd =
      typeof budgetConfig.monthlyBudgetUsd === "number" ? budgetConfig.monthlyBudgetUsd : null;
    const { usdPerActiveStudentMonth, derivedFloor } = computeCostMetrics({
      costMonthlyUsd: cost.totals.costMonthlyUsd,
      activeStudents,
      monthlyBudgetUsd,
    });

    let cloudCallsTotal = 0;
    let localCallsTotal = 0;
    for (const row of providerMix.rows) {
      cloudCallsTotal += row.completed.cloud;
      localCallsTotal += row.completed.local;
    }

    return {
      metrics: [
        {
          id: "usd_per_active_student_month",
          value: usdPerActiveStudentMonth,
          n: activeStudents,
          details: {
            windowDays: WINDOW_DAYS,
            activeStudents,
            costMonthlyUsd: cost.totals.costMonthlyUsd,
            monthlyBudgetUsd,
            derivedFloor,
            budgetCheck: cost.budgetCheck,
            budgetConfigPath: DEFAULT_BUDGET_CONFIG_PATH,
          },
        },
        {
          id: "cloud_calls_total",
          value: cloudCallsTotal,
          n: providerMix.totalAuditRows,
          details: { windowDays: WINDOW_DAYS },
        },
        {
          id: "local_calls_total",
          value: localCallsTotal,
          n: providerMix.totalAuditRows,
          details: { windowDays: WINDOW_DAYS },
        },
      ],
    };
  } finally {
    await prisma.$disconnect();
  }
}

function checkRequires(ctx) {
  if (!ctx.env.databaseUrl) {
    return "no prod-readonly connection string (BENCH_PROD_READONLY_URL not set)";
  }
  return null;
}

if (isMainModule(import.meta.url) && process.argv.includes("--self-test")) {
  runSelfTest({
    suiteName: "cost-per-student",
    configPath: "config/benchmarks/cost-per-student.json",
    run,
    checkRequires,
  }).then((code) => {
    process.exitCode = code;
  });
}
