#!/usr/bin/env node

/**
 * Backfill legacy Certification rows onto a catalog certType (D7,
 * 2026-09-07, `docs/plans/2026-09-07-todo-completion-plan.md` product
 * leftovers).
 *
 * Certification rows were always created with a hardcoded certType of
 * "ready-to-work" (src/app/api/certifications/route.ts). The create path
 * now accepts an optional catalog certId (src/lib/spokes/certifications.ts,
 * ~20 ids: "ic3", "mos-word", "workkeys-ncrc", …) and stores it going
 * forward. This script plans and, with --apply, executes a one-time
 * backfill for rows written before that, using
 * scripts/lib/cert-type-backfill-planner.mjs (dry-run-safe, no DB, tested
 * on its own).
 *
 * TODAY'S DATA-MODEL LIMIT, stated plainly so a "0 planned" run is never
 * mistaken for "already done": the `Certification` table
 * (prisma/schema.prisma) carries no name or issuer column, so every row
 * this script reads has name=null/issuer=null and the planner reports it
 * "left alone" (reason "no_name") — see the planner's own header for the
 * full reasoning. This script and its planner are still worth having: they
 * are exactly ready the day a name/issuer signal exists (a teacher-entered
 * field, a classify_attachment-derived title, …), proven correct now
 * against synthetic fixtures in cert-type-backfill-planner.test.mjs, and
 * they establish the counts-only, dry-run-default, prismaAdmin-privileged
 * shape every backfill in this repo follows (scripts/memory-pseudonymize
 * -backfill.mjs is the precedent this one mirrors).
 *
 * Dry run by default: prints COUNTS ONLY, never a student id or any
 * certification content. With --apply: rewrites each planned row's
 * certType to its resolved catalog id, skipping (and counting, not
 * crashing on) any row whose target certType would collide with a
 * Certification the same student already has under [studentId, certType].
 *
 * Uses `prismaAdmin` (cross-student, admin database role) and refuses to
 * run at all — dry run included — unless `adminClientIsPrivileged()`
 * confirms the connection actually bypasses RLS, matching the
 * memory-pseudonymize-backfill precedent: under `vq_app` with no RLS
 * context a cross-student read returns zero rows silently, which would
 * print "0 rows scanned" and look exactly like nothing to do.
 *
 * Usage:
 *   node scripts/certifications-backfill-cert-type.mjs                (dry run, every legacy row)
 *   node scripts/certifications-backfill-cert-type.mjs --apply
 *   node scripts/certifications-backfill-cert-type.mjs --limit=50
 *
 * Exit codes: 0 done (dry run or applied), 2 bad arguments, no connection,
 * or the admin client is not privileged.
 */

import { loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";
import {
  LEGACY_CERT_TYPE,
  planCertTypeBackfill,
  tallyCertTypeBackfillPlan,
} from "./lib/cert-type-backfill-planner.mjs";

const EXIT_OK = 0;
const EXIT_USAGE = 2;

const USAGE = [
  "usage: node scripts/certifications-backfill-cert-type.mjs [--apply] [--limit=N]",
  "  --apply    rewrite each planned row's certType; without it the script only reports counts",
  "  --limit    bound how many legacy Certification rows the run scans (ordered by id)",
  "connection: DATABASE_URL and ADMIN_DATABASE_URL (postgres role) must both be set",
];

loadEnvFile();

function printLines(lines) {
  for (const line of lines) console.log(line);
}

function parsePositiveInt(raw, flagName) {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${flagName} must be a positive integer, got "${raw}"`);
  }
  return value;
}

/**
 * Certification has no name/issuer column today (see the module header and
 * the planner's own header) — every row is read with both null. Kept as its
 * own function, rather than inlined into the query, so the day a real
 * signal exists it is one function to change and the rest of this script
 * (and its tests) is untouched.
 */
function toLegacyRow(certification) {
  return { id: certification.id, certType: certification.certType, name: null, issuer: null };
}

async function main() {
  const args = parseArgs();
  const apply = Boolean(args.apply);
  const limit = parsePositiveInt(args.limit, "limit");

  if (!process.env.DATABASE_URL || !process.env.ADMIN_DATABASE_URL) {
    console.error(
      "certifications-backfill-cert-type: set DATABASE_URL and ADMIN_DATABASE_URL (the postgres-role " +
        "connection string) before running.",
    );
    printLines(USAGE);
    return EXIT_USAGE;
  }

  // Dynamic + destructured imports of this project's `.ts` modules: this
  // project has no `"type": "module"` in package.json, so tsx transpiles a
  // directly-`.ts`-imported module to CommonJS, and Node's static import
  // analysis of that CJS output only ever resolves a `default` binding — a
  // static named import throws even though the export is really there.
  // Same pattern scripts/memory-pseudonymize-backfill.mjs uses.
  const { prismaAdmin } = await import("../src/lib/db.ts");
  const { adminClientIsPrivileged } = await import("../src/lib/nudges/admin-guard.ts");
  const { CERTIFICATIONS } = await import("../src/lib/spokes/certifications.ts");

  try {
    if (!(await adminClientIsPrivileged())) {
      console.error(
        "certifications-backfill-cert-type: the admin database client is not RLS-bypassing " +
          "(ADMIN_DATABASE_URL unset or pointed at the app role) — refusing to run rather than " +
          "silently scan zero rows.",
      );
      return EXIT_USAGE;
    }

    console.log(
      `certifications-backfill-cert-type ${new Date().toISOString()} mode=${apply ? "APPLY" : "dry-run"}` +
        (limit ? ` scope=first-${limit}-rows` : " scope=all-legacy-rows"),
    );

    const certifications = await prismaAdmin.certification.findMany({
      where: { certType: LEGACY_CERT_TYPE },
      select: { id: true, certType: true, studentId: true },
      orderBy: { id: "asc" },
      ...(limit ? { take: limit } : {}),
    });

    const plan = planCertTypeBackfill(certifications.map(toLegacyRow), CERTIFICATIONS);
    const tally = tallyCertTypeBackfillPlan(plan);

    let rewritten = 0;
    let collided = 0;

    if (apply && plan.planned.length > 0) {
      const byId = new Map(certifications.map((c) => [c.id, c]));
      for (const action of plan.planned) {
        const source = byId.get(action.id);
        try {
          await prismaAdmin.certification.update({
            where: { id: action.id },
            data: { certType: action.to },
          });
          rewritten++;
        } catch (error) {
          // P2002 = the student already has a Certification row under
          // [studentId, action.to] — count it and move on rather than
          // aborting the whole run over one collision.
          if (error?.code === "P2002") {
            collided++;
            continue;
          }
          throw new Error(
            `failed to rewrite certification ${source?.id ?? action.id}: ` +
              (error instanceof Error ? error.message : String(error)),
          );
        }
      }
    }

    console.log(
      `legacy rows scanned: ${certifications.length}, planned: ${tally.planned}, ` +
        `left alone (no name signal): ${tally.no_name}, left alone (no catalog match): ${tally.no_match}, ` +
        `left alone (ambiguous match): ${tally.ambiguous}` +
        (apply ? `, rewritten: ${rewritten}, skipped on collision: ${collided}` : ""),
    );
    if (!apply) {
      console.log("dry run: no rows changed. Re-run with --apply to write.");
    }
    if (tally.planned === 0) {
      console.log(
        "0 planned is expected today: Certification carries no name/issuer column to match against " +
          "(see this script's header) — this is not a sign the backfill already ran.",
      );
    }

    return EXIT_OK;
  } catch (error) {
    console.error(
      `certifications-backfill-cert-type failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return EXIT_USAGE;
  } finally {
    await prismaAdmin.$disconnect();
  }
}

main().then((code) => {
  process.exitCode = code;
});
