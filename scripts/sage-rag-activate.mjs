#!/usr/bin/env node

/**
 * Guarded activation and rollback for Sage RAG documents.
 *
 * Defaults to dry-run. Live activation requires:
 *   --apply --confirm=activate-sage-rag
 *
 * Rollback requires a manifest produced by a live activation:
 *   node scripts/sage-rag-activate.mjs --rollback=.planning/sage-rag/activation.json --apply --confirm=rollback-sage-rag
 */

import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  SAFE_STUDENT_CATEGORIES,
  STUDENT_VISIBLE_AUDIENCES,
  classifySageContextNote,
  ensureParentDir,
  loadEnvFile,
  parseArgs,
  splitCsv,
  summarizeCounts,
  timestampForFile,
} from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const args = parseArgs();
const prisma = new PrismaClient();
const categories = splitCsv(args.categories, SAFE_STUDENT_CATEGORIES);
const audiences = splitCsv(args.audiences, STUDENT_VISIBLE_AUDIENCES);
const quality = splitCsv(args.quality, ["good"]);
const limit = args.limit ? Number(args.limit) : null;
const apply = Boolean(args.apply);

function requireConfirm(expected) {
  if (!apply) return;
  if (args.confirm !== expected) {
    throw new Error(`Live mode requires --confirm=${expected}`);
  }
}

function printDocs(title, docs) {
  console.log(`\n${title} (${docs.length})`);
  for (const doc of docs.slice(0, 50)) {
    console.log(`  [${doc.category}/${doc.audience}/${doc.noteQuality}] ${doc.title}`);
    console.log(`    id: ${doc.id}`);
  }
  if (docs.length > 50) {
    console.log(`  ... ${docs.length - 50} more`);
  }
}

async function rollback(manifestPath) {
  requireConfirm("rollback-sage-rag");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const activatedIds = manifest.activatedIds ?? manifest.documents?.map((doc) => doc.id) ?? [];
  if (activatedIds.length === 0) {
    console.log("Manifest has no activated ids. Nothing to roll back.");
    return;
  }

  console.log(`Rollback manifest: ${manifestPath}`);
  console.log(`Documents to set usedBySage=false: ${activatedIds.length}`);

  if (!apply) {
    console.log("Mode: DRY RUN. No rows changed.");
    return;
  }

  const result = await prisma.programDocument.updateMany({
    where: { id: { in: activatedIds } },
    data: { usedBySage: false },
  });

  console.log(`Rolled back ${result.count} documents.`);
  console.log("Running app cache may keep old Sage document lists for up to 5 minutes.");
}

async function activate() {
  requireConfirm("activate-sage-rag");

  const rawDocs = await prisma.programDocument.findMany({
    where: {
      isActive: true,
      usedBySage: false,
      category: { in: categories },
      audience: { in: audiences },
    },
    select: {
      id: true,
      title: true,
      storageKey: true,
      category: true,
      audience: true,
      usedBySage: true,
      sageContextNote: true,
    },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });

  let docs = rawDocs
    .map((doc) => ({
      ...doc,
      noteQuality: classifySageContextNote(doc.sageContextNote, doc.title),
      noteLength: doc.sageContextNote?.trim().length ?? 0,
    }))
    .filter((doc) => quality.includes(doc.noteQuality));

  if (Number.isFinite(limit) && limit > 0) {
    docs = docs.slice(0, limit);
  }

  console.log("\nVisionQuest Sage RAG Activation");
  console.log(`Mode: ${apply ? "LIVE" : "DRY RUN"}`);
  console.log(`Categories: ${categories.join(", ")}`);
  console.log(`Audiences: ${audiences.join(", ")}`);
  console.log(`Note quality: ${quality.join(", ")}`);
  console.log(`Candidate rows after filters: ${docs.length}`);

  console.log("\nBy category:");
  for (const [key, value] of Object.entries(summarizeCounts(docs, (doc) => doc.category))) {
    console.log(`  ${key}: ${value}`);
  }

  printDocs("Documents selected", docs);

  if (!apply) {
    console.log("\nMode: DRY RUN. No rows changed.");
    console.log("To apply this exact filter, rerun with --apply --confirm=activate-sage-rag.");
    return;
  }

  if (docs.length === 0) {
    console.log("No documents selected. Nothing to activate.");
    return;
  }

  const ids = docs.map((doc) => doc.id);
  const result = await prisma.programDocument.updateMany({
    where: { id: { in: ids }, usedBySage: false },
    data: { usedBySage: true },
  });

  const manifestPath =
    args.manifest || `.planning/sage-rag/activation-${timestampForFile()}.json`;
  const manifest = {
    generatedAt: new Date().toISOString(),
    filters: { categories, audiences, quality, limit },
    activatedCount: result.count,
    activatedIds: ids,
    documents: docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      storageKey: doc.storageKey,
      category: doc.category,
      audience: doc.audience,
      noteQuality: doc.noteQuality,
      noteLength: doc.noteLength,
    })),
    rollbackCommand: `node scripts/sage-rag-activate.mjs --rollback=${manifestPath} --apply --confirm=rollback-sage-rag`,
  };

  ensureParentDir(manifestPath);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\nActivated ${result.count} documents.`);
  console.log(`Wrote rollback manifest: ${manifestPath}`);
  console.log(`Rollback command: ${manifest.rollbackCommand}`);
  console.log("Running app cache may keep old Sage document lists for up to 5 minutes.");
}

async function main() {
  if (args.rollback) {
    await rollback(String(args.rollback));
  } else {
    await activate();
  }
}

main()
  .catch((error) => {
    console.error("Activation failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
