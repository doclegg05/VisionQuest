#!/usr/bin/env node

/**
 * Corpus triage workbench for the ProgramDocument backlog that sits behind
 * `usedBySage=false` ("inactive" in .claude/MEMORY.md's Known Issues sense —
 * NOT the `isActive` column; see the `worksheet` header comment below).
 *
 * `loadSageDocuments()` (src/lib/sage/knowledge-base-server.ts) only ever
 * surfaces usedBySage:true, isActive:true rows to Sage's retrieval — so a
 * question whose only answer lives in one of these rows can't be grounded,
 * and Sage either declines or fabricates. This tool turns that backlog into
 * a TSV an owner can triage in one sitting: `worksheet` emits it, a human
 * fills in `disposition` + `reason` per row, `apply` validates and executes.
 *
 * This is the LEVER, not the triage — it never picks a disposition itself.
 *
 * Two subcommands:
 *
 *   tsx scripts/sage-rag-triage.mjs worksheet [--out=<path>]
 *       [--categories=CSV] [--audiences=CSV]
 *
 *   tsx scripts/sage-rag-triage.mjs apply --file=<worksheet.tsv>
 *       [--commit --confirm=apply-sage-rag-triage] [--embed] [--manifest=<path>]
 *       [--rollback=<manifest.json> --commit --confirm=rollback-sage-rag-triage]
 *
 * `apply` defaults to dry-run (prints the plan, touches nothing). `--commit`
 * requires `--confirm=apply-sage-rag-triage`, matching the guard convention
 * in sage-rag-activate.mjs / sage-rag-notes.mjs.
 *
 * Dispositions:
 *   activate — sets usedBySage=true, the exact mechanism sage-rag-activate.mjs
 *              uses (a plain flag flip; sageContextNote is left untouched).
 *              Rejected at validation if the row's isActive=false, because
 *              sage-rag-activate.mjs never activates an inactive row either
 *              — undelete it first via the teacher UI, then re-triage.
 *              Embeddings are NOT part of this flip (matching the mechanism
 *              it mirrors). Pass --embed to also run the real backfill
 *              (src/lib/sage/backfill-embeddings.ts, the same function
 *              `npm run sage:rag:backfill` calls) against the newly-active
 *              backlog in the same apply run.
 *   archive/exempt — no dedicated schema field exists for either state (see
 *              prisma/schema.prisma ProgramDocument). The least invasive
 *              existing field is `sageContextNote`: it is free text, never
 *              exposed to students (only the teacher-only GET
 *              /api/teacher/documents/sage-context reads it), and — as long
 *              as the marker stays short — classifies as "weak" under
 *              classifySageContextNote, so a later default
 *              `npm run sage:rag:activate` (quality=good only) will not
 *              silently reactivate it. The prior note value is captured in
 *              the apply manifest (and restorable via --rollback), not
 *              destroyed, so nothing curated is lost.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  classifySageContextNote,
  ensureParentDir,
  loadEnvFile,
  parseArgs,
  splitCsv,
  summarizeCounts,
  timestampForFile,
} from "./lib/sage-rag-utils.mjs";
import {
  DISPOSITIONS,
  bestNearDuplicate,
  buildTriageNote,
  normalizedTitleSortKey,
  parseTriageNote,
  parseTsv,
  titleTokens,
  writeTsv,
} from "./lib/sage-rag-triage-utils.mjs";

loadEnvFile();

const WORKSHEET_COLUMNS = [
  "id",
  "title",
  "category",
  "audience",
  "folder",
  "sizeBytes",
  "created",
  "isActive",
  "noteQuality",
  "nearDuplicate",
  "disposition",
  "reason",
];

const args = parseArgs();
const prisma = new PrismaClient();

function folderOf(storageKey) {
  const dir = dirname(storageKey || "");
  return dir === "." ? "(root)" : dir;
}

function dateOnly(date) {
  return date instanceof Date ? date.toISOString().slice(0, 10) : "";
}

// ── worksheet ────────────────────────────────────────────────────────────

async function worksheet() {
  const categories = args.categories ? splitCsv(args.categories) : null;
  const audiences = args.audiences ? splitCsv(args.audiences) : null;
  const outPath =
    args.out || `.planning/sage-rag/triage-worksheet-${timestampForFile()}.tsv`;

  const [inactiveDocs, activeDocs] = await Promise.all([
    prisma.programDocument.findMany({
      where: {
        usedBySage: false,
        ...(categories ? { category: { in: categories } } : {}),
        ...(audiences ? { audience: { in: audiences } } : {}),
      },
      select: {
        id: true,
        title: true,
        category: true,
        audience: true,
        storageKey: true,
        sizeBytes: true,
        createdAt: true,
        isActive: true,
        sageContextNote: true,
      },
    }),
    prisma.programDocument.findMany({
      where: { usedBySage: true, isActive: true },
      select: { title: true },
    }),
  ]);

  const activeTitleTokens = activeDocs.map((doc) => ({
    title: doc.title,
    tokens: titleTokens(doc.title),
  }));

  const withSortKey = inactiveDocs.map((doc) => {
    const marker = parseTriageNote(doc.sageContextNote);
    const dup = bestNearDuplicate(doc.title, activeTitleTokens);
    return {
      sortKey: `${doc.category} ${normalizedTitleSortKey(doc.title)}`,
      row: {
        id: doc.id,
        title: doc.title,
        category: doc.category,
        audience: doc.audience,
        folder: folderOf(doc.storageKey),
        sizeBytes: doc.sizeBytes ?? "",
        created: dateOnly(doc.createdAt),
        isActive: doc.isActive,
        noteQuality: classifySageContextNote(doc.sageContextNote, doc.title),
        nearDuplicate: dup ? `${dup.title} (${Math.round(dup.score * 100)}%)` : "",
        disposition: marker ? marker.disposition : "",
        reason: marker ? marker.reason : "",
      },
    };
  });

  const rows = [...withSortKey]
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    .map((entry) => entry.row);

  const alreadyMarked = {
    archive: rows.filter((r) => r.disposition === "archive").length,
    exempt: rows.filter((r) => r.disposition === "exempt").length,
  };

  ensureParentDir(outPath);
  writeFileSync(outPath, writeTsv(WORKSHEET_COLUMNS, rows));

  const totalCorpus = await prisma.programDocument.count();
  const totalActive = activeDocs.length; // usedBySage:true && isActive:true

  console.log("\nSage RAG Corpus Triage — Worksheet");
  console.log(`Corpus total: ${totalCorpus} ProgramDocument rows`);
  console.log(`Already surfaced to Sage (usedBySage:true, isActive:true): ${totalActive}`);
  console.log(`Backlog written to worksheet (usedBySage:false): ${rows.length}`);
  console.log(
    `  of which isActive:false (soft-deleted, activate disposition will be rejected): ${
      rows.filter((r) => r.isActive === false).length
    }`,
  );
  console.log(
    `  already marked from a prior apply run: ${alreadyMarked.archive} archive, ${alreadyMarked.exempt} exempt`,
  );
  console.log("\nBy category:");
  for (const [key, value] of Object.entries(summarizeCounts(rows, (r) => r.category))) {
    console.log(`  ${key}: ${value}`);
  }
  console.log("\nBy note quality:");
  for (const [key, value] of Object.entries(summarizeCounts(rows, (r) => r.noteQuality))) {
    console.log(`  ${key}: ${value}`);
  }
  console.log(`\nWrote worksheet: ${outPath}`);
  console.log(
    "Fill in `disposition` (activate|archive|exempt) and `reason` per row, then run:",
  );
  console.log(`  tsx scripts/sage-rag-triage.mjs apply --file=${outPath}`);
}

// ── apply ────────────────────────────────────────────────────────────────

function requireConfirm(expected) {
  if (!args.commit) return;
  if (args.confirm !== expected) {
    throw new Error(`--commit requires --confirm=${expected}`);
  }
}

function loadWorksheetRows(filePath) {
  const text = readFileSync(filePath, "utf8");
  const { rows } = parseTsv(text);
  return rows;
}

/** Validate all rows before touching the DB. Returns grouped-by-disposition valid rows, or throws with every error listed. */
async function validateRows(rows) {
  const errors = [];
  const seenIds = new Set();
  const idsInFile = [];

  for (const row of rows) {
    const id = (row.id || "").trim();
    const disposition = (row.disposition || "").trim().toLowerCase();
    if (!id) {
      errors.push(`line ${row.__line}: missing id`);
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(`line ${row.__line}: duplicate id ${id}`);
      continue;
    }
    seenIds.add(id);
    idsInFile.push(id);
    if (!disposition) {
      errors.push(`line ${row.__line} (${id}): missing disposition`);
    } else if (!DISPOSITIONS.includes(disposition)) {
      errors.push(
        `line ${row.__line} (${id}): invalid disposition "${row.disposition}" — must be one of ${DISPOSITIONS.join("|")}`,
      );
    }
  }

  const dbDocs = await prisma.programDocument.findMany({
    where: { id: { in: idsInFile } },
    select: { id: true, title: true, isActive: true, usedBySage: true, sageContextNote: true },
  });
  const dbById = new Map(dbDocs.map((doc) => [doc.id, doc]));

  for (const id of idsInFile) {
    if (!dbById.has(id)) {
      errors.push(`unknown id (no ProgramDocument row): ${id}`);
    }
  }

  const validRows = rows.filter((row) => {
    const id = (row.id || "").trim();
    const disposition = (row.disposition || "").trim().toLowerCase();
    return id && DISPOSITIONS.includes(disposition) && dbById.has(id);
  });

  for (const row of validRows) {
    const id = row.id.trim();
    const disposition = row.disposition.trim().toLowerCase();
    const doc = dbById.get(id);
    if (disposition === "activate" && doc.isActive === false) {
      errors.push(
        `${id} (${doc.title}): disposition=activate but isActive=false — sage:rag:activate never activates an inactive row; restore isActive first (teacher UI) or choose archive/exempt`,
      );
    }
    if ((disposition === "archive" || disposition === "exempt") && doc.usedBySage === true) {
      console.warn(
        `WARNING: ${id} (${doc.title}) is currently usedBySage:true — ${disposition} will record the note but will NOT turn off retrieval. Use PATCH /api/teacher/documents/sage-context to also disable it.`,
      );
    }
  }

  if (errors.length > 0) {
    const preview = errors.slice(0, 30).join("\n  ");
    const more = errors.length > 30 ? `\n  ... ${errors.length - 30} more` : "";
    throw new Error(`Worksheet validation failed (${errors.length} error(s)):\n  ${preview}${more}`);
  }

  return { validRows, dbById };
}

function groupByDisposition(validRows) {
  const groups = { activate: [], archive: [], exempt: [] };
  for (const row of validRows) {
    groups[row.disposition.trim().toLowerCase()].push(row);
  }
  return groups;
}

async function runEmbedBackfill(dryRun) {
  const { backfillProgramDocumentEmbeddings } = await import(
    "../src/lib/sage/backfill-embeddings.ts"
  );
  console.log(`\n--embed: running backfillProgramDocumentEmbeddings (dryRun=${dryRun})…`);
  const tally = await backfillProgramDocumentEmbeddings({
    force: false,
    all: false,
    dryRun,
    onProgress: (message) => console.log(`  ${message}`),
  });
  console.log(`Embedding tally: ${JSON.stringify(tally)}`);
  return tally;
}

async function apply() {
  if (args.rollback) {
    await rollback(String(args.rollback));
    return;
  }

  if (!args.file) {
    throw new Error("apply requires --file=<worksheet.tsv>");
  }

  requireConfirm("apply-sage-rag-triage");

  const rows = loadWorksheetRows(String(args.file));
  const { validRows, dbById } = await validateRows(rows);
  const groups = groupByDisposition(validRows);

  console.log("\nSage RAG Corpus Triage — Apply");
  console.log(`Mode: ${args.commit ? "COMMIT" : "DRY RUN"}`);
  console.log(`File: ${args.file}`);
  console.log(
    `Rows: ${validRows.length} (activate=${groups.activate.length}, archive=${groups.archive.length}, exempt=${groups.exempt.length})`,
  );

  for (const [name, group] of Object.entries(groups)) {
    if (group.length === 0) continue;
    console.log(`\n${name} (${group.length}):`);
    for (const row of group.slice(0, 25)) {
      console.log(`  ${row.id}  ${dbById.get(row.id.trim()).title}`);
    }
    if (group.length > 25) console.log(`  ... ${group.length - 25} more`);
  }

  if (!args.commit) {
    console.log("\nMode: DRY RUN. No rows changed.");
    if (args.embed) {
      await runEmbedBackfill(true);
    }
    console.log(
      "\nTo apply for real: rerun with --commit --confirm=apply-sage-rag-triage" +
        (args.embed ? " --embed" : ""),
    );
    return;
  }

  const now = new Date();
  const manifest = {
    generatedAt: now.toISOString(),
    file: String(args.file),
    activate: [],
    archive: [],
    exempt: [],
  };

  if (groups.activate.length > 0) {
    const ids = groups.activate.map((row) => row.id.trim());
    const result = await prisma.programDocument.updateMany({
      where: { id: { in: ids }, usedBySage: false },
      data: { usedBySage: true },
    });
    manifest.activate = ids.map((id) => ({ id, title: dbById.get(id).title }));
    console.log(
      `\nActivated ${result.count} of ${ids.length} requested (rest were already usedBySage:true).`,
    );
  }

  for (const disposition of ["archive", "exempt"]) {
    for (const row of groups[disposition]) {
      const id = row.id.trim();
      const doc = dbById.get(id);
      const newNote = buildTriageNote(disposition, row.reason, now);
      await prisma.programDocument.update({
        where: { id },
        data: { sageContextNote: newNote },
      });
      manifest[disposition].push({
        id,
        title: doc.title,
        previousSageContextNote: doc.sageContextNote,
        newSageContextNote: newNote,
      });
    }
  }
  if (groups.archive.length > 0) console.log(`Archived (note recorded): ${groups.archive.length}`);
  if (groups.exempt.length > 0) console.log(`Exempted (note recorded): ${groups.exempt.length}`);

  const manifestPath =
    args.manifest || `.planning/sage-rag/triage-apply-${timestampForFile(now)}.json`;
  manifest.rollbackCommand = `tsx scripts/sage-rag-triage.mjs apply --rollback=${manifestPath} --commit --confirm=rollback-sage-rag-triage`;
  ensureParentDir(manifestPath);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nWrote manifest: ${manifestPath}`);
  console.log(`Rollback command: ${manifest.rollbackCommand}`);
  console.log("Running app cache may keep old Sage document lists for up to 5 minutes.");

  if (args.embed) {
    await runEmbedBackfill(false);
  } else if (groups.activate.length > 0) {
    console.log("\nNote: newly-activated docs are NOT embedded yet (no --embed passed).");
    console.log(
      "Run `npm run sage:rag:backfill` (or rerun apply with --embed) before relying on retrieval.",
    );
  }
}

async function rollback(manifestPath) {
  requireConfirm("rollback-sage-rag-triage");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const activateIds = (manifest.activate ?? []).map((e) => e.id);
  const noteRestores = [...(manifest.archive ?? []), ...(manifest.exempt ?? [])];

  console.log(`\nRollback manifest: ${manifestPath}`);
  console.log(`Activate reversions: ${activateIds.length}`);
  console.log(`Note restores: ${noteRestores.length}`);

  if (!args.commit) {
    console.log("Mode: DRY RUN. No rows changed.");
    return;
  }

  if (activateIds.length > 0) {
    const result = await prisma.programDocument.updateMany({
      where: { id: { in: activateIds } },
      data: { usedBySage: false },
    });
    console.log(`Reverted usedBySage to false for ${result.count} documents.`);
  }

  for (const entry of noteRestores) {
    await prisma.programDocument.update({
      where: { id: entry.id },
      data: { sageContextNote: entry.previousSageContextNote },
    });
  }
  if (noteRestores.length > 0) {
    console.log(`Restored sageContextNote for ${noteRestores.length} documents.`);
  }
}

// ── entry ────────────────────────────────────────────────────────────────

async function main() {
  const [subcommand] = process.argv.slice(2);
  if (subcommand === "worksheet") {
    await worksheet();
  } else if (subcommand === "apply") {
    await apply();
  } else {
    console.error("Usage: tsx scripts/sage-rag-triage.mjs <worksheet|apply> [options]");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("sage-rag-triage failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
