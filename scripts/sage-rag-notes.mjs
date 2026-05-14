#!/usr/bin/env node

/**
 * Guarded Sage RAG note curation and rollback.
 *
 * Defaults to dry-run. Live note updates require:
 *   --apply --confirm=update-sage-rag-notes
 *
 * Rollback requires a manifest produced by a live update:
 *   node scripts/sage-rag-notes.mjs --rollback=.planning/sage-rag/notes.json --apply --confirm=rollback-sage-rag-notes
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
  summarizeCounts,
  timestampForFile,
} from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const args = parseArgs();
const prisma = new PrismaClient();
const apply = Boolean(args.apply);
const configPath = args.config || "config/sage-rag-curated-notes.json";

function requireConfirm(expected) {
  if (!apply) return;
  if (args.confirm !== expected) {
    throw new Error(`Live mode requires --confirm=${expected}`);
  }
}

function normalizeNote(note) {
  return typeof note === "string" ? note.trim() : "";
}

function normalizeExisting(note) {
  const normalized = normalizeNote(note);
  return normalized.length > 0 ? normalized : null;
}

function readConfig() {
  const entries = JSON.parse(readFileSync(configPath, "utf8"));
  if (!Array.isArray(entries)) {
    throw new Error(`Expected ${configPath} to contain an array`);
  }

  const seen = new Set();
  return entries.map((entry, index) => {
    const storageKey = normalizeNote(entry.storageKey);
    const note = normalizeNote(entry.note);
    if (!storageKey) {
      throw new Error(`Entry ${index + 1} is missing storageKey`);
    }
    if (!note) {
      throw new Error(`Entry ${index + 1} (${storageKey}) is missing note`);
    }
    if (seen.has(storageKey)) {
      throw new Error(`Duplicate storageKey in ${configPath}: ${storageKey}`);
    }
    seen.add(storageKey);
    return { storageKey, note };
  });
}

function isStudentSafe(doc) {
  return (
    doc.isActive &&
    SAFE_STUDENT_CATEGORIES.includes(doc.category) &&
    STUDENT_VISIBLE_AUDIENCES.includes(doc.audience)
  );
}

function printEntries(title, entries) {
  console.log(`\n${title} (${entries.length})`);
  for (const entry of entries.slice(0, 50)) {
    console.log(`  [${entry.category}/${entry.audience}] ${entry.title}`);
    console.log(`    key: ${entry.storageKey}`);
    if (entry.currentQuality || entry.nextQuality) {
      console.log(
        `    note: ${entry.currentQuality ?? "unknown"} -> ${entry.nextQuality ?? "unknown"}`,
      );
    }
    if (entry.reason) {
      console.log(`    reason: ${entry.reason}`);
    }
  }
  if (entries.length > 50) {
    console.log(`  ... ${entries.length - 50} more`);
  }
}

async function rollback(manifestPath) {
  requireConfirm("rollback-sage-rag-notes");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const updates = manifest.updates ?? [];
  if (updates.length === 0) {
    console.log("Manifest has no note updates. Nothing to roll back.");
    return;
  }

  console.log(`Rollback manifest: ${manifestPath}`);
  console.log(`Documents to restore: ${updates.length}`);

  if (!apply) {
    console.log("Mode: DRY RUN. No rows changed.");
    return;
  }

  await prisma.$transaction(
    updates.map((entry) =>
      prisma.programDocument.update({
        where: { id: entry.id },
        data: { sageContextNote: entry.previousSageContextNote },
      }),
    ),
  );

  console.log(`Restored ${updates.length} Sage context notes.`);
  console.log("Running app cache may keep old Sage document lists for up to 5 minutes.");
}

async function updateNotes() {
  requireConfirm("update-sage-rag-notes");

  const entries = readConfig();
  const storageKeys = entries.map((entry) => entry.storageKey);
  const docs = await prisma.programDocument.findMany({
    where: { storageKey: { in: storageKeys } },
    select: {
      id: true,
      title: true,
      storageKey: true,
      category: true,
      audience: true,
      isActive: true,
      usedBySage: true,
      sageContextNote: true,
    },
  });

  const docsByStorageKey = new Map(docs.map((doc) => [doc.storageKey, doc]));
  const missing = [];
  const unsafe = [];
  const weakNewNotes = [];
  const unchanged = [];
  const updates = [];

  for (const entry of entries) {
    const doc = docsByStorageKey.get(entry.storageKey);
    if (!doc) {
      missing.push({
        storageKey: entry.storageKey,
        title: "(missing)",
        category: "UNKNOWN",
        audience: "UNKNOWN",
        reason: "No ProgramDocument row has this storageKey",
      });
      continue;
    }

    const currentQuality = classifySageContextNote(doc.sageContextNote, doc.title);
    const nextQuality = classifySageContextNote(entry.note, doc.title);
    const base = {
      id: doc.id,
      title: doc.title,
      storageKey: doc.storageKey,
      category: doc.category,
      audience: doc.audience,
      isActive: doc.isActive,
      usedBySage: doc.usedBySage,
      currentQuality,
      nextQuality,
    };

    if (!isStudentSafe(doc)) {
      unsafe.push({
        ...base,
        reason: "Document is inactive, teacher-only, or outside the student-safe category allowlist",
      });
      continue;
    }

    if (nextQuality !== "good") {
      weakNewNotes.push({
        ...base,
        reason: "Curated note does not meet the audit quality threshold",
      });
      continue;
    }

    const previousSageContextNote = normalizeExisting(doc.sageContextNote);
    const nextSageContextNote = entry.note;
    if (previousSageContextNote === nextSageContextNote) {
      unchanged.push(base);
      continue;
    }

    updates.push({
      ...base,
      previousSageContextNote,
      nextSageContextNote,
    });
  }

  console.log("\nVisionQuest Sage RAG Note Curation");
  console.log(`Mode: ${apply ? "LIVE" : "DRY RUN"}`);
  console.log(`Config: ${configPath}`);
  console.log(`Config entries: ${entries.length}`);
  console.log(`Eligible updates: ${updates.length}`);
  console.log(`Unchanged: ${unchanged.length}`);
  console.log(`Missing: ${missing.length}`);
  console.log(`Unsafe/skipped: ${unsafe.length}`);
  console.log(`Weak curated notes/skipped: ${weakNewNotes.length}`);

  console.log("\nEligible updates by category:");
  for (const [key, value] of Object.entries(summarizeCounts(updates, (entry) => entry.category))) {
    console.log(`  ${key}: ${value}`);
  }

  printEntries("Eligible note updates", updates);
  if (missing.length > 0) printEntries("Missing storage keys", missing);
  if (unsafe.length > 0) printEntries("Unsafe skipped documents", unsafe);
  if (weakNewNotes.length > 0) printEntries("Weak curated notes", weakNewNotes);

  if (!apply) {
    console.log("\nMode: DRY RUN. No rows changed.");
    console.log("To apply these note updates, rerun with --apply --confirm=update-sage-rag-notes.");
    return;
  }

  if (missing.length > 0 || unsafe.length > 0 || weakNewNotes.length > 0) {
    throw new Error("Refusing live update while config has missing, unsafe, or weak entries.");
  }

  if (updates.length === 0) {
    console.log("No note changes selected. Nothing to update.");
    return;
  }

  await prisma.$transaction(
    updates.map((entry) =>
      prisma.programDocument.update({
        where: { id: entry.id },
        data: { sageContextNote: entry.nextSageContextNote },
      }),
    ),
  );

  const manifestPath = args.manifest || `.planning/sage-rag/notes-${timestampForFile()}.json`;
  const manifest = {
    generatedAt: new Date().toISOString(),
    configPath,
    updateCount: updates.length,
    updates: updates.map((entry) => ({
      id: entry.id,
      title: entry.title,
      storageKey: entry.storageKey,
      category: entry.category,
      audience: entry.audience,
      usedBySageAtUpdate: entry.usedBySage,
      previousQuality: entry.currentQuality,
      nextQuality: entry.nextQuality,
      previousSageContextNote: entry.previousSageContextNote,
      nextSageContextNote: entry.nextSageContextNote,
    })),
    rollbackCommand: `node scripts/sage-rag-notes.mjs --rollback=${manifestPath} --apply --confirm=rollback-sage-rag-notes`,
  };

  ensureParentDir(manifestPath);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\nUpdated ${updates.length} Sage context notes.`);
  console.log(`Wrote rollback manifest: ${manifestPath}`);
  console.log(`Rollback command: ${manifest.rollbackCommand}`);
  console.log("Running app cache may keep old Sage document lists for up to 5 minutes.");
}

async function main() {
  if (args.rollback) {
    await rollback(String(args.rollback));
  } else {
    await updateNotes();
  }
}

main()
  .catch((error) => {
    console.error("Note curation failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
