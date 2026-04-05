#!/usr/bin/env npx tsx

/**
 * Seed script for app-knowledge content into the Sage RAG system.
 *
 * Reads all .md files from src/content/app-knowledge/, parses YAML
 * frontmatter for audience, and ingests each file as curated app_knowledge.
 *
 * Usage:
 *   npm run seed:app-knowledge
 */

import fs from "node:fs";
import path from "node:path";
import { ingestFile } from "../src/lib/rag/ingest";
import type { IngestResult } from "../src/lib/rag/ingest";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APP_KNOWLEDGE_DIR = path.resolve("src/content/app-knowledge");

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

function parseAudience(
  content: string,
): "student" | "teacher" | "both" | undefined {
  const parts = content.split("---");
  if (parts.length < 3) return undefined;

  const frontmatter = parts[1];
  const match = frontmatter.match(/audience:\s*(student|teacher|both)/);
  return match ? (match[1] as "student" | "teacher" | "both") : undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!fs.existsSync(APP_KNOWLEDGE_DIR)) {
    process.stderr.write(
      `Error: directory not found: ${APP_KNOWLEDGE_DIR}\n`,
    );
    process.exit(1);
  }

  const entries = fs.readdirSync(APP_KNOWLEDGE_DIR, { withFileTypes: true });
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(APP_KNOWLEDGE_DIR, e.name))
    .sort();

  if (mdFiles.length === 0) {
    process.stdout.write("No .md files found in app-knowledge directory.\n");
    return;
  }

  process.stdout.write(
    `\nSeeding ${mdFiles.length} app-knowledge file(s)...\n\n`,
  );

  const results: Array<{ file: string; result: IngestResult }> = [];

  for (const filePath of mdFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    const audience = parseAudience(content);
    const fileName = path.basename(filePath);

    process.stdout.write(`  ${fileName} (audience: ${audience ?? "none"})...`);

    const result = await ingestFile(filePath, {
      sourceType: "app_knowledge",
      sourceTier: "curated",
      sourceWeight: 2.0,
      audience,
    });

    results.push({ file: fileName, result });

    if (result.error) {
      process.stdout.write(` ERROR: ${result.error}\n`);
    } else if (result.skipped) {
      process.stdout.write(" skipped (unchanged)\n");
    } else {
      process.stdout.write(` ${result.chunksCreated} chunks\n`);
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const ingested = results.filter((r) => !r.result.skipped && !r.result.error);
  const skipped = results.filter((r) => r.result.skipped);
  const failed = results.filter((r) => r.result.error);
  const totalChunks = ingested.reduce(
    (sum, r) => sum + r.result.chunksCreated,
    0,
  );

  process.stdout.write("\n--- Seed Summary ---\n");
  process.stdout.write(`  Files processed : ${results.length}\n`);
  process.stdout.write(`  Ingested        : ${ingested.length}\n`);
  process.stdout.write(`  Total chunks    : ${totalChunks}\n`);
  process.stdout.write(`  Skipped         : ${skipped.length}\n`);
  process.stdout.write(`  Failed          : ${failed.length}\n`);

  if (failed.length > 0) {
    process.stdout.write("\n--- Failures ---\n");
    for (const f of failed) {
      process.stdout.write(
        `  ${f.file}: ${f.result.error}\n`,
      );
    }
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Fatal error: ${message}\n`);
  process.exit(1);
});
