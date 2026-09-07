#!/usr/bin/env node

/**
 * Pseudonymize legacy SageMemory rows written before store.ts's write-time
 * pass (ticket D5b, `docs/audits/2026-09-06-ferpa-pii-review.md` Sprint 3).
 *
 * `src/lib/sage/memory/store.ts` now pseudonymizes `content` before it is
 * stored — `[STUDENT_NAME]`, `[EMAIL_n]`, etc. Rows written before that
 * shipped hold the raw name, and their `sourceHash` (computed over the
 * STORED text) no longer matches the pseudonymized twin a later turn
 * extracts, so the same underlying fact can double-store.
 *
 * Dry run by default: prints counts only, per student and in aggregate,
 * never a name or a content string. With --apply: rewrites each row whose
 * pseudonymized content differs from what is stored (recomputing sourceHash
 * and re-embedding so the vector matches the new text), and deletes the
 * OLDER of any two rows that land on the same final content (the twin the
 * review predicted) — the newer one is kept, rewritten if it still needs it.
 *
 * Uses `prismaAdmin` (cross-student, admin database role) and refuses to run
 * at all — dry run included — unless `adminClientIsPrivileged()` confirms
 * the connection actually bypasses RLS. Under `vq_app` with no RLS context,
 * a cross-student read returns zero rows silently, which would print "0
 * memories to pseudonymize" and look exactly like nothing to do (the F63
 * failure mode: "nobody got a text" reads identically to "nothing was due").
 *
 * Usage:
 *   node scripts/memory-pseudonymize-backfill.mjs                  (dry run, every student)
 *   node scripts/memory-pseudonymize-backfill.mjs --apply
 *   node scripts/memory-pseudonymize-backfill.mjs --student=<cuid>
 *   node scripts/memory-pseudonymize-backfill.mjs --limit=50
 *   npm run memory:pseudonymize:backfill -- --apply
 *
 * Exit codes: 0 done (dry run or applied), 2 bad arguments, no connection,
 * or the admin client is not privileged.
 */

import { loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";
import { planMemoryPseudonymization, tallyPlan } from "./lib/memory-pseudonymize-backfill.mjs";

const EXIT_OK = 0;
const EXIT_USAGE = 2;

const USAGE = [
  "usage: node scripts/memory-pseudonymize-backfill.mjs [--apply] [--student=<cuid>] [--limit=N]",
  "  --apply    rewrite/dedupe rows; without it the script only reports counts",
  "  --student  limit the run to one student's SageMemory rows (subjectType=student)",
  "  --limit    bound how many students the run scans (ordered by subject id)",
  "connection: DATABASE_URL and ADMIN_DATABASE_URL (postgres role) must both be set",
];

/** Every SageMemory row this backfill rewrites is embedded in batches of this size. */
const EMBED_BATCH = 32;

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
 * Replicates `loadStudentIdentity` (src/lib/ai/identity.ts) field-for-field,
 * against `prismaAdmin` instead of the RLS-scoped app client — the reason is
 * structural, not a shortcut: `loadIdentityInput` is keyed by session role
 * and reads through `prisma`, which enforces the CALLER's own RLS context.
 * This script has no session and touches every student in turn, so there is
 * no single RLS context it could run under; `loadIdentityInput` would see
 * nothing (no context = zero rows) for every subject and silently produce
 * empty vaults, degrading every row to "unchanged" without ever explaining
 * why. Reading the same four SELECTs directly through the admin client keeps
 * the same four fields `loadStudentIdentity` vaults and no more.
 */
async function loadStudentIdentityForBackfill(prismaAdmin, studentId) {
  const [row, smsPref] = await Promise.all([
    prismaAdmin.student.findUnique({
      where: { id: studentId },
      select: { displayName: true, email: true, studentId: true },
    }),
    prismaAdmin.notificationPreference.findFirst({
      where: { studentId, channel: "sms" },
      select: { destination: true },
    }),
  ]);

  const clean = (value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };

  const identity = {};
  const name = clean(row?.displayName);
  if (name) identity.studentName = name;
  const email = clean(row?.email);
  if (email) identity.studentEmail = email;
  const loginId = clean(row?.studentId);
  if (loginId) identity.studentLoginId = loginId;
  const phone = clean(smsPref?.destination);
  if (phone) identity.studentPhone = phone;
  return identity;
}

async function resolveSubjectIds(prismaAdmin, { studentArg, limit }) {
  if (studentArg) return [studentArg];

  const rows = await prismaAdmin.sageMemory.findMany({
    where: { subjectType: "student", validTo: null },
    distinct: ["subjectId"],
    select: { subjectId: true },
    orderBy: { subjectId: "asc" },
    ...(limit ? { take: limit } : {}),
  });
  return rows.map((row) => row.subjectId);
}

async function applyPlan({ prismaAdmin, embedTexts, toVectorLiteral, activeModel, subjectId, actions }) {
  // Deletes BEFORE rewrites: the partial unique index on (subjectType,
  // subjectId, sourceHash) for active rows would otherwise reject a rewrite
  // that targets a hash still held by the duplicate about to be dropped.
  const dedupeActions = actions.filter((action) => action.type === "dedupe");
  const rewriteActions = actions.filter((action) => action.type === "rewrite");

  for (const action of dedupeActions) {
    await prismaAdmin.sageMemory.delete({ where: { id: action.id } });
  }

  for (let start = 0; start < rewriteActions.length; start += EMBED_BATCH) {
    const batch = rewriteActions.slice(start, start + EMBED_BATCH);
    const vectors = await embedTexts(
      batch.map((action) => action.content),
      {
        taskType: "RETRIEVAL_DOCUMENT",
        usage: {
          studentId: subjectId,
          callSite: "memory_pseudonymize_backfill",
          sensitivity: "student_record",
        },
      },
    );
    for (let i = 0; i < batch.length; i++) {
      const action = batch[i];
      await prismaAdmin.sageMemory.update({
        where: { id: action.id },
        data: { content: action.content, sourceHash: action.sourceHash },
      });
      const vectorLiteral = toVectorLiteral(vectors[i]);
      await prismaAdmin.$executeRaw`
        UPDATE "visionquest"."SageMemory"
        SET embedding = ${vectorLiteral}::vector(768),
            "embeddingModel" = ${activeModel}
        WHERE id = ${action.id}
      `;
    }
  }
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printLines(USAGE);
    return EXIT_OK;
  }

  let limit;
  try {
    limit = parsePositiveInt(args.limit, "limit");
  } catch (error) {
    console.error(`memory-pseudonymize-backfill: ${error.message}`);
    printLines(USAGE);
    return EXIT_USAGE;
  }

  const studentArg = typeof args.student === "string" && args.student.trim() ? args.student.trim() : null;
  const apply = args.apply === true;

  if (!process.env.DATABASE_URL || !process.env.ADMIN_DATABASE_URL) {
    console.error(
      "memory-pseudonymize-backfill: set DATABASE_URL and ADMIN_DATABASE_URL (the postgres-role connection string) before running.",
    );
    printLines(USAGE);
    return EXIT_USAGE;
  }

  // Dynamic + destructured imports of this project's `.ts` modules — see the
  // comment at the top of scripts/lib/memory-pseudonymize-backfill.mjs for
  // why a static `import { X } from "....ts"` does not work here.
  const { prismaAdmin } = await import("../src/lib/db.ts");
  const { adminClientIsPrivileged } = await import("../src/lib/nudges/admin-guard.ts");
  const { embedTexts, toVectorLiteral } = await import("../src/lib/ai/embeddings.ts");
  const { getActiveEmbeddingModel } = await import("../src/lib/ai/embedding-provider.ts");

  try {
    if (!(await adminClientIsPrivileged())) {
      console.error(
        "memory-pseudonymize-backfill: the admin database client is not RLS-bypassing (ADMIN_DATABASE_URL " +
          "unset or pointed at the app role) — refusing to run rather than silently scan zero rows.",
      );
      return EXIT_USAGE;
    }

    console.log(
      `memory-pseudonymize-backfill ${new Date().toISOString()} mode=${apply ? "APPLY" : "dry-run"}` +
        (studentArg ? " scope=one-student" : limit ? ` scope=first-${limit}-students` : " scope=all-students"),
    );

    const subjectIds = await resolveSubjectIds(prismaAdmin, { studentArg, limit });
    const activeModel = apply ? await getActiveEmbeddingModel() : null;

    let studentsScanned = 0;
    let rowsRewritten = 0;
    let rowsDeduped = 0;
    let rowsUnchanged = 0;

    for (const subjectId of subjectIds) {
      studentsScanned++;

      const rows = await prismaAdmin.sageMemory.findMany({
        where: { subjectType: "student", subjectId, validTo: null },
        select: { id: true, subjectType: true, subjectId: true, content: true, sourceHash: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });
      if (rows.length === 0) continue;

      const identity = await loadStudentIdentityForBackfill(prismaAdmin, subjectId);
      const actions = planMemoryPseudonymization(rows, identity);
      const tally = tallyPlan(actions);
      rowsRewritten += tally.rewritten;
      rowsDeduped += tally.deduped;
      rowsUnchanged += tally.unchanged;

      if (apply && (tally.rewritten > 0 || tally.deduped > 0)) {
        await applyPlan({ prismaAdmin, embedTexts, toVectorLiteral, activeModel, subjectId, actions });
      }
    }

    console.log(
      `students scanned: ${studentsScanned}, rows rewritten: ${rowsRewritten}, ` +
        `rows deduped: ${rowsDeduped}, rows unchanged: ${rowsUnchanged}`,
    );
    if (!apply) {
      console.log("dry run: no rows changed. Re-run with --apply to write.");
    }

    return EXIT_OK;
  } catch (error) {
    console.error(`memory-pseudonymize-backfill failed: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  } finally {
    await prismaAdmin.$disconnect();
  }
}

main().then((code) => {
  process.exitCode = code;
});
