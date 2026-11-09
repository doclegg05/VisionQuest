#!/usr/bin/env node

/**
 * Backfill vacancy keys and snapshots onto saved jobs made before W4
 * (durable saved and hidden jobs, 2026-11-09). Design:
 * docs/superpowers/specs/2026-11-09-durable-job-preferences-design.md
 *
 * Run after `prisma migrate deploy` applies
 * 20261109120000_durable_job_preferences. Until it runs, a legacy save whose
 * listing is deleted keeps its status, notes and dates but has no snapshot,
 * and shows as a job that is no longer listed.
 *
 * Reads every StudentSavedJob with no vacancyKey and a linked JobListing,
 * plans with scripts/lib/job-preferences-backfill-planner.mjs (pure,
 * tested), and with --apply writes vacancyKey, listingKind = "class" and the
 * snapshot. Idempotent: keyed rows are never read again, and each write
 * requires the row to still be unkeyed. One student's two saves of one
 * vacancy (the same posting saved in two classes) key the newest row and
 * leave the rest unkeyed; they keep working through jobListingId. Find them
 * later with: SELECT count(*) FROM visionquest."StudentSavedJob"
 * WHERE "vacancyKey" IS NULL AND "jobListingId" IS NOT NULL;
 *
 * Dry run by default. Prints COUNTS ONLY, never a student id or job content.
 * Uses prismaAdmin and refuses to run unless the admin client bypasses RLS,
 * since under vq_app a cross-student read silently returns zero rows.
 *
 * Usage:
 *   node --import tsx scripts/job-preferences-backfill.mjs            (dry run)
 *   node --import tsx scripts/job-preferences-backfill.mjs --apply
 *
 * Exit codes: 0 done (dry run or applied), 2 no connection, the admin client
 * is not privileged, or the run failed.
 */

import { loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";
import { planJobPreferencesBackfill } from "./lib/job-preferences-backfill-planner.mjs";

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const NAME = "job-preferences-backfill";

loadEnvFile();

const LISTING_SELECT = {
  title: true,
  company: true,
  location: true,
  url: true,
  source: true,
  sourceId: true,
  expiresAt: true,
};

async function loadInputs(prismaAdmin) {
  const [unkeyed, keyed] = await Promise.all([
    prismaAdmin.studentSavedJob.findMany({
      where: { vacancyKey: null },
      select: { id: true, studentId: true, updatedAt: true, jobListing: { select: LISTING_SELECT } },
      orderBy: { id: "asc" },
    }),
    prismaAdmin.studentSavedJob.findMany({
      where: { vacancyKey: { not: null } },
      select: { studentId: true, vacancyKey: true },
    }),
  ]);
  return { unkeyed, existingKeys: new Set(keyed.map((row) => `${row.studentId}\u0000${row.vacancyKey}`)) };
}

async function applyPlan(prismaAdmin, planned) {
  let written = 0;
  let skipped = 0;
  for (const action of planned) {
    try {
      const result = await prismaAdmin.studentSavedJob.updateMany({
        where: { id: action.id, vacancyKey: null },
        data: action.data,
      });
      written += result.count;
      skipped += 1 - result.count;
    } catch (error) {
      // P2002: the student gained a keyed row for this vacancy mid-run.
      if (error?.code !== "P2002") throw error;
      skipped += 1;
    }
  }
  return { written, skipped };
}

async function main() {
  const apply = Boolean(parseArgs().apply);
  if (!process.env.DATABASE_URL || !process.env.ADMIN_DATABASE_URL) {
    console.error(`${NAME}: set DATABASE_URL and ADMIN_DATABASE_URL (the postgres-role connection) first.`);
    return EXIT_USAGE;
  }

  // Dynamic imports: tsx turns these .ts modules into CommonJS, which only
  // exposes a default binding to a static named import (same as the other
  // backfills in scripts/).
  const { prismaAdmin } = await import("../src/lib/db.ts");
  const { adminClientIsPrivileged } = await import("../src/lib/nudges/admin-guard.ts");
  const { vacancyKeyFor, vacancySnapshotFor } = await import("../src/lib/job-board/vacancy-identity.ts");

  try {
    if (!(await adminClientIsPrivileged())) {
      console.error(`${NAME}: the admin database client does not bypass RLS; refusing to scan zero rows.`);
      return EXIT_USAGE;
    }
    console.log(`${NAME} ${new Date().toISOString()} mode=${apply ? "APPLY" : "dry-run"}`);

    const { unkeyed, existingKeys } = await loadInputs(prismaAdmin);
    const plan = planJobPreferencesBackfill(unkeyed, existingKeys, {
      keyFor: vacancyKeyFor,
      snapshotFor: vacancySnapshotFor,
      now: new Date(),
    });
    const result = apply ? await applyPlan(prismaAdmin, plan.planned) : null;

    console.log(
      `unkeyed rows: ${unkeyed.length}, planned: ${plan.planned.length}, ` +
        `left unkeyed (same vacancy saved twice): ${plan.collisions}, no listing: ${plan.noListing}, ` +
        `no usable key: ${plan.noKey}` +
        (result ? `, written: ${result.written}, skipped: ${result.skipped}` : ""),
    );
    if (!apply) console.log("dry run: no rows changed. Re-run with --apply to write.");
    return EXIT_OK;
  } catch (error) {
    console.error(`${NAME} failed: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  } finally {
    await prismaAdmin.$disconnect();
  }
}

main().then((code) => {
  process.exitCode = code;
});
