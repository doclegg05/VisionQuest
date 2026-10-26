#!/usr/bin/env node

/**
 * Purge expired RateLimitEntry and FailedExtraction rows — the first cut of
 * automated retention enforcement (ticket E4,
 * docs/plans/2026-09-07-todo-completion-plan.md §4). See
 * docs/DATA_RETENTION_POLICY.md "Not Yet Implemented" for why this script
 * acts on exactly these two categories and nothing else: everything else in
 * the retention table is student data subject to the export-before-purge
 * rule, which has no automation yet — purging it here would violate that
 * rule. RateLimitEntry (security rate-limit counters) and FailedExtraction
 * (an internal dead-letter queue, already exported by the offboarding
 * bundle where relevant) are not student data records themselves.
 *
 * Dry run by default: prints counts per category and the cutoff each is
 * measured against. With --apply, deletes rows older than their category's
 * duration in config/retention-policy.json (also documented in
 * docs/DATA_RETENTION_POLICY.md's table — a unit test asserts they agree).
 * Never prints a row identifier (RateLimitEntry.key, FailedExtraction.id,
 * or the studentId on a FailedExtraction row) — counts and cutoffs only,
 * per .claude/rules/security.md.
 *
 * Connection: ADMIN_DATABASE_URL, falling back to DATABASE_URL. It must be
 * the postgres-role connection string — both tables are RLS-protected
 * (RateLimitEntry: `rate_limit_entry_admin_only`; FailedExtraction:
 * `failed_extraction_access`, admin-or-managing-teacher), so the vq_app
 * role without an admin RLS context sees zero or a subset of rows, and a
 * plain app connection would under-report or refuse to delete.
 *
 * Usage:
 *   node scripts/retention-purge.mjs                (dry run)
 *   node scripts/retention-purge.mjs --apply
 *   npm run retention:purge -- --apply
 *
 * Exit codes: 0 done (dry run or applied), 2 bad arguments or no connection.
 */

import { PrismaClient } from "@prisma/client";
import { loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";
import {
  buildPurgePlan,
  formatPurgeReport,
  loadRetentionPolicy,
  parseRetentionPurgeArgs,
} from "./lib/retention-purge.mjs";

const EXIT_OK = 0;
const EXIT_USAGE = 2;

const USAGE = [
  "usage: node scripts/retention-purge.mjs [--apply]",
  "  --apply    perform the deletions; without it the script only reports counts",
  "connection: ADMIN_DATABASE_URL, falling back to DATABASE_URL (postgres role)",
  "durations: read from config/retention-policy.json (kept in sync with docs/DATA_RETENTION_POLICY.md)",
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

function printLines(lines) {
  for (const line of lines) console.log(line);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printLines(USAGE);
    return EXIT_OK;
  }

  const { apply } = parseRetentionPurgeArgs(args);

  const url = resolveConnectionUrl(process.env);
  if (!url) {
    console.error(
      "retention-purge: set ADMIN_DATABASE_URL (or DATABASE_URL) to the postgres-role connection string.",
    );
    return EXIT_USAGE;
  }

  const policy = loadRetentionPolicy();
  const plan = buildPurgePlan({ policy });
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    console.log(
      `retention-purge ${new Date().toISOString()} target=${describeConnection(url)} mode=${apply ? "APPLY" : "dry-run"}`,
    );

    const rateLimitCount = await prisma.rateLimitEntry.count({ where: plan.rateLimitEntry.where });
    const failedExtractionCount = await prisma.failedExtraction.count({ where: plan.failedExtraction.where });

    printLines(
      formatPurgeReport({
        plan,
        counts: { rateLimitEntry: rateLimitCount, failedExtraction: failedExtractionCount },
        mode: apply ? "APPLY" : "dry-run",
      }),
    );

    if (!apply) {
      console.log("dry run: no rows changed. Re-run with --apply to purge them.");
      return EXIT_OK;
    }

    if (rateLimitCount === 0 && failedExtractionCount === 0) {
      console.log("nothing to purge.");
      return EXIT_OK;
    }

    const rateLimitResult = await prisma.rateLimitEntry.deleteMany({ where: plan.rateLimitEntry.where });
    const failedExtractionResult = await prisma.failedExtraction.deleteMany({ where: plan.failedExtraction.where });

    console.log(
      `applied: RateLimitEntry ${rateLimitResult.count} row(s) deleted, ` +
        `FailedExtraction ${failedExtractionResult.count} row(s) deleted`,
    );
    return EXIT_OK;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`retention-purge failed: ${message}`);
    return EXIT_USAGE;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => {
  process.exitCode = code;
});
