#!/usr/bin/env node

/**
 * Backfill — reopen orientation items completed without a signature (P0-1).
 *
 * The welcome-flow quick-win button used to let students mark
 * signature-required orientation items complete with a bare "I've read this"
 * click, so those forms were never signed. This script finds every
 * OrientationProgress row with completed=true whose item maps to one or more
 * `sign` orientation steps (per src/lib/orientation-step-resources.ts, the
 * same classification the wizard uses) but has no matching signed
 * FormSubmission — one with a SignaturePad image (`signatureFileId`) or a
 * staff-approved uploaded signed copy (`status: "approved"`).
 *
 * DRY-RUN BY DEFAULT — prints what would change and writes nothing.
 * Pass --apply to:
 *   1. reset the offending progress rows (completed=false, completedAt=null)
 *   2. open a StudentAlert per affected student (type/key
 *      `orientation_form_missing:<studentId>` — the same key the advising
 *      sync manages, so the alert stays in the staff queue until the forms
 *      are actually signed, then resolves through the normal sync)
 *
 * Idempotent: re-running after --apply finds nothing left to change.
 *
 * Usage:
 *   npx tsx scripts/backfill-unsigned-orientation-items.mjs           # dry-run
 *   npx tsx scripts/backfill-unsigned-orientation-items.mjs --apply   # write
 */

import { loadEnvFile } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const APPLY = process.argv.includes("--apply");

function summarizeMissingForms(titles) {
  const unique = [...new Set(titles)];
  if (unique.length > 3) {
    return `${unique.slice(0, 3).join(", ")}, and ${unique.length - 3} more required onboarding forms`;
  }
  return unique.join(", ");
}

async function findViolations(prisma, getSignatureRequiredForms) {
  const progressRows = await prisma.orientationProgress.findMany({
    where: { completed: true },
    select: {
      id: true,
      studentId: true,
      item: { select: { id: true, label: true } },
    },
  });

  // Classify each completed row; keep only items with signature-required steps.
  const signFormsByLabel = new Map();
  const candidates = [];
  for (const row of progressRows) {
    const label = row.item.label;
    if (!signFormsByLabel.has(label)) {
      signFormsByLabel.set(label, getSignatureRequiredForms(label));
    }
    const signForms = signFormsByLabel.get(label);
    if (signForms.length > 0) {
      candidates.push({ row, signForms });
    }
  }

  if (candidates.length === 0) {
    return { scanned: progressRows.length, candidates: 0, violations: [] };
  }

  const studentIds = [...new Set(candidates.map((c) => c.row.studentId))];
  const formIds = [...new Set(candidates.flatMap((c) => c.signForms.map((f) => f.id)))];

  const signedSubmissions = await prisma.formSubmission.findMany({
    where: {
      studentId: { in: studentIds },
      formId: { in: formIds },
      OR: [{ signatureFileId: { not: null } }, { status: "approved" }],
    },
    select: { studentId: true, formId: true },
  });
  const signedKeys = new Set(signedSubmissions.map((s) => `${s.studentId}:${s.formId}`));

  const violations = [];
  for (const { row, signForms } of candidates) {
    const missing = signForms.filter((form) => !signedKeys.has(`${row.studentId}:${form.id}`));
    if (missing.length > 0) {
      violations.push({ row, missing });
    }
  }

  return { scanned: progressRows.length, candidates: candidates.length, violations };
}

async function planAlerts(prisma, violations) {
  const byStudent = new Map();
  for (const violation of violations) {
    const entry = byStudent.get(violation.row.studentId) ?? [];
    byStudent.set(violation.row.studentId, [
      ...entry,
      ...violation.missing.map((form) => form.title),
    ]);
  }

  const alertKeys = [...byStudent.keys()].map((id) => `orientation_form_missing:${id}`);
  const existingAlerts = await prisma.studentAlert.findMany({
    where: { alertKey: { in: alertKeys } },
    select: { alertKey: true },
  });
  const existingKeys = new Set(existingAlerts.map((alert) => alert.alertKey));

  const toCreate = [];
  let alreadyPresent = 0;
  for (const [studentId, titles] of byStudent) {
    if (existingKeys.has(`orientation_form_missing:${studentId}`)) {
      alreadyPresent += 1;
      continue;
    }
    toCreate.push({ studentId, titles });
  }

  return { toCreate, alreadyPresent, affectedStudents: byStudent.size };
}

async function applyChanges(prisma, violations, alertPlan) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.orientationProgress.updateMany({
      where: { id: { in: violations.map((v) => v.row.id) } },
      data: { completed: false, completedAt: null },
    });

    for (const { studentId, titles } of alertPlan.toCreate) {
      await tx.studentAlert.create({
        data: {
          studentId,
          alertKey: `orientation_form_missing:${studentId}`,
          type: "orientation_form_missing",
          severity: "high",
          status: "open",
          title: "Required onboarding forms are still missing",
          summary: `${summarizeMissingForms(titles)} still need to be signed — orientation items were reopened because no signed copy is on file.`,
          sourceType: "student",
          sourceId: studentId,
          detectedAt: now,
        },
      });
    }
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set — refusing to start. No database was touched.",
    );
    process.exitCode = 1;
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const { getSignatureRequiredForms } = await import(
    "../src/lib/orientation-step-resources.ts"
  );

  const prisma = new PrismaClient();
  try {
    console.log(`${APPLY ? "APPLY" : "Dry-run"}: scanning completed orientation items for missing signatures…`);

    const { scanned, candidates, violations } = await findViolations(
      prisma,
      getSignatureRequiredForms,
    );

    console.log(
      `Scanned ${scanned} completed progress rows; ${candidates} map to signature-required steps.`,
    );

    if (violations.length === 0) {
      console.log("Nothing to change — every signature-required completion has a signed form on file.");
      return;
    }

    for (const { row, missing } of violations) {
      console.log(
        `  student=${row.studentId} item="${row.item.label}" missing signed: ${missing
          .map((form) => form.id)
          .join(", ")}`,
      );
    }

    const alertPlan = await planAlerts(prisma, violations);

    if (!APPLY) {
      console.log(
        `\nDry-run summary: would reset ${violations.length} progress row(s) across ` +
          `${alertPlan.affectedStudents} student(s); would open ${alertPlan.toCreate.length} staff alert(s) ` +
          `(${alertPlan.alreadyPresent} already present). Re-run with --apply to write.`,
      );
      return;
    }

    await applyChanges(prisma, violations, alertPlan);

    console.log(
      `\nApplied: reset ${violations.length} progress row(s) across ${alertPlan.affectedStudents} student(s); ` +
        `opened ${alertPlan.toCreate.length} staff alert(s) (${alertPlan.alreadyPresent} already present).`,
    );
    console.log("Re-running now reports nothing to change (idempotent).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Backfill failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
