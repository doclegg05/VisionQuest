#!/usr/bin/env npx tsx

/**
 * Bulk content ingestion script for the Sage RAG system.
 *
 * Usage:
 *   npm run ingest                          # ingest entire content/ directory
 *   npm run ingest -- --dir=content/01-program-handbook  # target subdirectory
 *   npm run ingest -- --dry-run             # preview without ingesting
 */

import fs from "node:fs";
import path from "node:path";
import { ingestDirectory } from "../src/lib/rag/ingest";

// ---------------------------------------------------------------------------
// Supported extensions (mirrors ingest.ts EXT_TO_MIME)
// ---------------------------------------------------------------------------

const SUPPORTED_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".md", ".txt"]);
const SKIP_DIRECTORIES = new Set(["_archive", "node_modules", ".git"]);

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  dir: string;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let dir = "content";
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  return { dir, dryRun };
}

// ---------------------------------------------------------------------------
// Dry-run: walk directory and list supported files
// ---------------------------------------------------------------------------

function walkDirectorySync(dirPath: string): string[] {
  const files: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) {
        continue;
      }
      files.push(...walkDirectorySync(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { dir, dryRun } = parseArgs();
  const resolvedDir = path.resolve(dir);

  if (!fs.existsSync(resolvedDir)) {
    process.stderr.write(`Error: directory not found: ${resolvedDir}\n`);
    process.exit(1);
  }

  if (dryRun) {
    const files = walkDirectorySync(resolvedDir);
    process.stdout.write(`\n[dry-run] Would ingest ${files.length} file(s) from ${resolvedDir}:\n\n`);
    for (const file of files) {
      process.stdout.write(`  ${path.relative(process.cwd(), file)}\n`);
    }
    process.stdout.write("\nNo changes made.\n");
    return;
  }

  process.stdout.write(`\nIngesting from ${resolvedDir} ...\n\n`);

  const results = await ingestDirectory(resolvedDir, {
    sourceType: "program_doc",
    sourceTier: "canonical",
    sourceWeight: 3.0,
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const ingested = results.filter((r) => !r.skipped && !r.error);
  const skipped = results.filter((r) => r.skipped);
  const failed = results.filter((r) => r.error);
  const totalChunks = ingested.reduce((sum, r) => sum + r.chunksCreated, 0);

  process.stdout.write("--- Ingestion Summary ---\n");
  process.stdout.write(`  Files ingested : ${ingested.length}\n`);
  process.stdout.write(`  Total chunks   : ${totalChunks}\n`);
  process.stdout.write(`  Skipped        : ${skipped.length}\n`);
  process.stdout.write(`  Failed         : ${failed.length}\n`);

  if (failed.length > 0) {
    process.stdout.write("\n--- Failures ---\n");
    for (const f of failed) {
      process.stdout.write(`  [${f.sourceDocumentId || "n/a"}] ${f.error}\n`);
    }
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal error: ${message}\n`);
  process.exit(1);
});
