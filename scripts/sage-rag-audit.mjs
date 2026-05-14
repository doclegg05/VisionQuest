#!/usr/bin/env node

/**
 * Audit the current Supabase ProgramDocument corpus for Sage RAG readiness.
 *
 * Non-destructive. Defaults to student-visible, student-safe categories.
 *
 * Usage:
 *   node scripts/sage-rag-audit.mjs
 *   node scripts/sage-rag-audit.mjs --json
 *   node scripts/sage-rag-audit.mjs --out=.planning/sage-rag/audit.json
 */

import { writeFileSync } from "node:fs";
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
} from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const args = parseArgs();
const prisma = new PrismaClient();
const categories = splitCsv(args.categories, SAFE_STUDENT_CATEGORIES);
const audiences = splitCsv(args.audiences, STUDENT_VISIBLE_AUDIENCES);

function pct(part, total) {
  if (!total) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function qualityRow(doc) {
  return {
    id: doc.id,
    title: doc.title,
    storageKey: doc.storageKey,
    category: doc.category,
    audience: doc.audience,
    usedBySage: doc.usedBySage,
    noteQuality: classifySageContextNote(doc.sageContextNote, doc.title),
    noteLength: doc.sageContextNote?.trim().length ?? 0,
  };
}

async function main() {
  const [allCounts, candidateDocs] = await Promise.all([
    prisma.programDocument.groupBy({
      by: ["category", "audience", "isActive", "usedBySage"],
      _count: { _all: true },
    }),
    prisma.programDocument.findMany({
      where: {
        isActive: true,
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
    }),
  ]);

  const rows = candidateDocs.map(qualityRow);
  const good = rows.filter((row) => row.noteQuality === "good");
  const weak = rows.filter((row) => row.noteQuality === "weak");
  const empty = rows.filter((row) => row.noteQuality === "empty");
  const usableNow = rows.filter((row) => row.usedBySage);

  const report = {
    generatedAt: new Date().toISOString(),
    filters: { categories, audiences },
    totals: {
      allGroupedRows: allCounts.length,
      candidateDocs: rows.length,
      usedBySageCandidates: usableNow.length,
      goodNotes: good.length,
      weakNotes: weak.length,
      emptyNotes: empty.length,
      goodNoteCoverage: rows.length ? good.length / rows.length : 0,
    },
    byCategory: summarizeCounts(rows, (row) => row.category),
    byAudience: summarizeCounts(rows, (row) => row.audience),
    byQuality: summarizeCounts(rows, (row) => row.noteQuality),
    byCategoryAndQuality: summarizeCounts(rows, (row) => `${row.category}:${row.noteQuality}`),
    activationReady: good.map((row) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      audience: row.audience,
      storageKey: row.storageKey,
    })),
    weakSamples: weak.slice(0, 25),
    emptySamples: empty.slice(0, 25),
  };

  if (args.out) {
    ensureParentDir(args.out);
    writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("\nVisionQuest Sage RAG Audit");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Candidates: ${rows.length}`);
  console.log(`Already used by Sage: ${usableNow.length}`);
  console.log(`Good notes: ${good.length} (${pct(good.length, rows.length)})`);
  console.log(`Weak notes: ${weak.length} (${pct(weak.length, rows.length)})`);
  console.log(`Empty notes: ${empty.length} (${pct(empty.length, rows.length)})`);

  console.log("\nBy category:");
  for (const [key, value] of Object.entries(report.byCategory)) {
    console.log(`  ${key}: ${value}`);
  }

  console.log("\nBy note quality:");
  for (const [key, value] of Object.entries(report.byQuality)) {
    console.log(`  ${key}: ${value}`);
  }

  console.log("\nActivation-ready sample:");
  for (const row of good.slice(0, 12)) {
    console.log(`  [${row.category}] ${row.title}`);
  }

  if (weak.length > 0) {
    console.log("\nWeak-note sample:");
    for (const row of weak.slice(0, 8)) {
      console.log(`  [${row.category}] ${row.title} (${row.noteLength} chars)`);
    }
  }

  if (empty.length > 0) {
    console.log("\nEmpty-note sample:");
    for (const row of empty.slice(0, 8)) {
      console.log(`  [${row.category}] ${row.title}`);
    }
  }

  if (args.out) {
    console.log(`\nWrote JSON report: ${args.out}`);
  }
}

main()
  .catch((error) => {
    console.error("Audit failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
