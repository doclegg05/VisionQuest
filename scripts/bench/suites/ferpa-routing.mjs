/**
 * bench suite: ferpa-routing (config/benchmarks/ferpa-routing.json)
 *
 * student_record_cloud_ratio = completed student_record calls served by a
 * cloud provider / total completed student_record calls, over the trailing
 * 30 days — reusing buildProviderMix() from scripts/sage-ai-accountability.mjs
 * (exported this session, no CLI behavior change), connected via
 * BENCH_PROD_READONLY_URL.
 *
 * The floor is 0 ONLY when BENCH_FERPA_LOCAL_EXPECTED=1: student_record is
 * local-only BY POLICY (src/lib/ai/provider.ts, .claude/rules/sage-ai.md),
 * but the code documents a deliberate fail-OPEN to cloud when the local
 * provider is unavailable (VQ-R-002/003, an open FERPA ruling in
 * .claude/MEMORY.md's Open Items) — and no local AI host is live in prod
 * today. Gating this at 0 unconditionally would fail every night for a
 * reason nobody can fix without standing up the local host first, which is
 * exactly the kind of gate that gets ignored or disabled. So this ships
 * info until an operator sets BENCH_FERPA_LOCAL_EXPECTED=1 (once the local
 * host is actually deployed and load-bearing), and the result always
 * carries a header note naming which mode it ran in.
 */

import { PrismaClient } from "@prisma/client";
import { LOCAL_ONLY_SENSITIVITIES, buildProviderMix } from "../../sage-ai-accountability.mjs";
import { selfTest } from "../lib/self-test.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const SENSITIVITY = "student_record";

/**
 * Pure decision logic, tested without a database in
 * ferpa-routing.test.mjs: computes the ratio and, only when
 * `localHostExpected` is true, throws on any nonzero ratio — this is the
 * "floor 0 ONLY when BENCH_FERPA_LOCAL_EXPECTED=1" rule made real. The
 * static suite config's `metrics[].floor` field cannot itself be
 * conditioned on an environment variable, so the gate lives here: a thrown
 * error fails the suite the same way a floor breach would once the runner
 * (Phase 0) exists, rather than silently passing through as an unenforced
 * "info" metric whenever the flag happens to be set.
 *
 * @param {{ cloudCompleted: number, totalCompleted: number, localHostExpected: boolean }} input
 * @returns {{ id: "student_record_cloud_ratio", value: number, n: number, details: object }}
 */
export function ferpaRoutingMetric({ cloudCompleted, totalCompleted, localHostExpected }) {
  const ratio = totalCompleted === 0 ? 0 : cloudCompleted / totalCompleted;
  if (localHostExpected && ratio > 0) {
    throw new Error(
      `FERPA ROUTING FLOOR BREACHED: student_record_cloud_ratio=${ratio} (${cloudCompleted}/${totalCompleted}) ` +
        `with BENCH_FERPA_LOCAL_EXPECTED=1 — student_record calls must stay local once the local AI host is expected to be live.`
    );
  }
  return {
    id: "student_record_cloud_ratio",
    value: ratio,
    n: totalCompleted,
    details: {
      windowDays: WINDOW_DAYS,
      sensitivity: SENSITIVITY,
      cloudCompleted,
      totalCompleted,
      localHostExpected,
      headerNote: localHostExpected
        ? "BENCH_FERPA_LOCAL_EXPECTED=1: gated at floor 0 — the local AI host is expected to be live and load-bearing."
        : 'BENCH_FERPA_LOCAL_EXPECTED is not set to "1": this metric is informational because no local AI host is live in prod yet, and the provider fails OPEN to cloud by design when local is unavailable (VQ-R-002/003, open FERPA ruling in .claude/MEMORY.md Open Items). Do not read a nonzero ratio here as a regression until that host exists.',
    },
  };
}

/** @param {object} ctx @returns {Promise<{ metrics: Array<object> }>} */
export async function run(ctx) {
  const url = ctx.env.prodReadonlyUrl;
  if (!url) {
    throw new Error("ferpa-routing requires prod-readonly: set BENCH_PROD_READONLY_URL.");
  }
  if (!LOCAL_ONLY_SENSITIVITIES.includes(SENSITIVITY)) {
    // Defensive: if this ever stops being local-only-by-policy, the metric's
    // meaning changes and this suite needs a human to look at it, not a
    // silent pass.
    throw new Error(
      `"${SENSITIVITY}" is no longer in LOCAL_ONLY_SENSITIVITIES (src/lib/ai/provider.ts policy changed) — this suite's premise no longer holds.`
    );
  }

  const localHostExpected = process.env.BENCH_FERPA_LOCAL_EXPECTED === "1";
  const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS);
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const auditRows = await prisma.auditLog.findMany({
      where: { targetType: "ai_request", createdAt: { gte: since } },
      select: { metadata: true, createdAt: true },
    });

    const providerMix = buildProviderMix(auditRows, null);
    const row = providerMix.rows.find((r) => r.sensitivity === SENSITIVITY);
    const totalCompleted = row?.completed.total ?? 0;
    const cloudCompleted = row?.completed.cloud ?? 0;

    return { metrics: [ferpaRoutingMetric({ cloudCompleted, totalCompleted, localHostExpected })] };
  } finally {
    await prisma.$disconnect();
  }
}

await selfTest(import.meta.url, run);
