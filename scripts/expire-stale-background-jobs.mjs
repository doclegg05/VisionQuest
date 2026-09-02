#!/usr/bin/env node

/**
 * Expire stale pending BackgroundJob rows — decision D4 from the 2026-09-01
 * review (finding F1: the pg_cron job-processor never ran in production, so
 * the queue holds months-old pending work, including queued emails that
 * should not be sent late).
 *
 * Dry run by default: prints counts by job type inside the window and the
 * exact error text that would be written. With --apply, sets every pending
 * row created before --before to status "failed" with
 * error = "expired by operator on <today>: <reason>". Never prints payloads.
 *
 * Why status "failed": see scripts/lib/expire-stale-jobs.mjs. In short,
 * src/lib/jobs.ts only ever claims pending rows, and "failed" is the status it
 * already writes for work that will not run.
 *
 * Connection: ADMIN_DATABASE_URL, falling back to DATABASE_URL. It must be
 * the postgres-role connection string — BackgroundJob is RLS-protected
 * (policy background_job_admin_only), so the vq_app role sees zero rows.
 *
 * Usage:
 *   node scripts/expire-stale-background-jobs.mjs --before=2026-06-01 --reason="..."          (dry run)
 *   node scripts/expire-stale-background-jobs.mjs --before=2026-06-01 --reason="..." --apply
 *   npm run jobs:expire-stale -- --before=2026-06-01 --reason="..."
 *
 * Exit codes: 0 done (dry run or applied), 2 bad arguments or no connection.
 */

import { PrismaClient } from "@prisma/client";
import { loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";
import { formatExpiryPlan, parseExpireArgs, planExpiry } from "./lib/expire-stale-jobs.mjs";

const EXIT_OK = 0;
const EXIT_USAGE = 2;

const USAGE = [
  "usage: node scripts/expire-stale-background-jobs.mjs --before=<ISO date> --reason=<text> [--apply]",
  "  --before   expire pending rows created before this ISO date (required, must not be in the future)",
  "  --reason   written into each row's error column as 'expired by operator on <today>: <reason>' (required)",
  "  --apply    perform the update; without it the script only reports counts by type",
  "connection: ADMIN_DATABASE_URL, falling back to DATABASE_URL (postgres role)",
];

loadEnvFile();

function resolveConnectionUrl(env) {
  const url = env.ADMIN_DATABASE_URL || env.DATABASE_URL || "";
  return url.trim() || null;
}

/** Host and database only — never the credentials. */
function describeConnection(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname || "(socket)"}/${parsed.pathname.replace(/^\//, "") || "(default)"}`;
  } catch {
    return "(unparseable url)";
  }
}

async function countPendingByType(prisma, where) {
  const groups = await prisma.backgroundJob.groupBy({
    by: ["type"],
    where,
    _count: { _all: true },
  });
  return groups.map((group) => ({ type: group.type, count: group._count._all }));
}

function printLines(lines) {
  for (const line of lines) console.log(line);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printLines(USAGE);
    return EXIT_OK;
  }

  const parsed = parseExpireArgs(args);
  if (!parsed.ok) {
    console.error(`expire-stale-background-jobs: ${parsed.message}`);
    printLines(USAGE);
    return EXIT_USAGE;
  }

  const url = resolveConnectionUrl(process.env);
  if (!url) {
    console.error(
      "expire-stale-background-jobs: set ADMIN_DATABASE_URL (or DATABASE_URL) to the postgres-role connection string."
    );
    return EXIT_USAGE;
  }

  const today = new Date().toISOString().slice(0, 10);
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    console.log(`expire-stale-background-jobs ${new Date().toISOString()} target=${describeConnection(url)} mode=${parsed.apply ? "APPLY" : "dry-run"}`);

    const where = { status: "pending", createdAt: { lt: parsed.before } };
    const beforeGroups = await countPendingByType(prisma, where);
    const plan = planExpiry({ groups: beforeGroups, before: parsed.before, today, reason: parsed.reason });

    printLines(formatExpiryPlan({ label: "before", plan }));
    console.log(`would set status=${plan.data.status} error="${plan.data.error}"`);

    if (!parsed.apply) {
      console.log("dry run: no rows changed. Re-run with --apply to expire them.");
      return EXIT_OK;
    }

    if (plan.total === 0) {
      console.log("nothing to expire.");
      return EXIT_OK;
    }

    const result = await prisma.backgroundJob.updateMany({ where: plan.where, data: plan.data });
    console.log(`applied: ${result.count} rows set to status=${plan.data.status}`);

    const afterGroups = await countPendingByType(prisma, plan.where);
    printLines(formatExpiryPlan({ label: "after", plan: { ...plan, ...planExpiry({ groups: afterGroups, before: parsed.before, today, reason: parsed.reason }) } }));
    return EXIT_OK;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`expire-stale-background-jobs failed: ${message}`);
    return EXIT_USAGE;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => {
  process.exitCode = code;
});
