#!/usr/bin/env node

/**
 * Read-only integrity audit for Sage document RAG + longitudinal memory.
 *
 * Verifies the full chain agents depend on:
 * local source file (when docs-upload exists) -> ProgramDocument row ->
 * active-model document/chunk embeddings, plus active SageMemory embeddings.
 * Duplicate titles are reported with storage keys so curation can distinguish
 * intentional copies from accidental collisions.
 *
 * Usage:
 *   npm run sage:index:integrity
 *   npm run sage:index:integrity -- --json
 *   npm run sage:index:integrity -- --strict
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const args = parseArgs();
const prisma = new PrismaClient();
const NON_INDEXED_EXTENSIONS = new Set([".url", ".ai"]);

function collectLocalFiles(root, relative = "") {
  const dir = path.join(root, relative);
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...collectLocalFiles(root, rel));
    else if (!NON_INDEXED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(rel);
  }
  return files;
}

function duplicateTitles(rows) {
  const grouped = new Map();
  for (const row of rows.filter((item) => item.isActive)) {
    const key = row.title.trim().toLowerCase();
    const group = grouped.get(key) ?? [];
    group.push(row.storageKey);
    grouped.set(key, group);
  }
  return [...grouped.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([title, keys]) => ({ title, count: keys.length, storageKeys: keys.sort() }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

async function main() {
  const { getActiveEmbeddingModel } = await import("../src/lib/ai/embedding-provider.ts");
  const { mapLocalPathToStorageKey } = await import("../src/lib/storage.ts");
  const activeModel = await getActiveEmbeddingModel();

  const docs = await prisma.$queryRawUnsafe(
    `SELECT d.id, d.title, d."storageKey", d."isActive", d."usedBySage",
            (d.embedding IS NOT NULL) AS "hasEmbedding", d."embeddingModel",
            COUNT(c.id)::int AS "chunkCount",
            COUNT(c.id) FILTER (WHERE c.embedding IS NULL)::int AS "missingChunkEmbeddings",
            COUNT(c.id) FILTER (
              WHERE c."embeddingModel" IS DISTINCT FROM $1
            )::int AS "staleChunkEmbeddings"
     FROM "visionquest"."ProgramDocument" d
     LEFT JOIN "visionquest"."DocumentChunk" c ON c."documentId" = d.id
     GROUP BY d.id
     ORDER BY d."storageKey"`,
    activeModel,
  );

  const memories = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) FILTER (WHERE "validTo" IS NULL)::int AS active,
            COUNT(*) FILTER (WHERE "validTo" IS NULL AND embedding IS NULL)::int AS "missingEmbedding",
            COUNT(*) FILTER (
              WHERE "validTo" IS NULL AND "embeddingModel" IS DISTINCT FROM $1
            )::int AS "staleEmbedding"
     FROM "visionquest"."SageMemory"`,
    activeModel,
  );

  const retrievable = docs.filter((doc) => doc.isActive && doc.usedBySage);
  const docsMissingEmbedding = retrievable.filter((doc) => !doc.hasEmbedding);
  const docsStaleModel = retrievable.filter((doc) => doc.embeddingModel !== activeModel);
  const docsWithStaleChunks = retrievable.filter((doc) => doc.staleChunkEmbeddings > 0);
  const docsWithNoChunks = retrievable.filter((doc) => doc.chunkCount === 0);

  let local = { available: false };
  const docsRoot = path.resolve(process.cwd(), "docs-upload");
  if (existsSync(docsRoot)) {
    const overridesPath = path.resolve(process.cwd(), "config", "sage-overrides.json");
    const excluded = existsSync(overridesPath)
      ? new Set(JSON.parse(readFileSync(overridesPath, "utf8")).exclude ?? [])
      : new Set();
    const sourceFiles = collectLocalFiles(docsRoot).filter((sourcePath) => !excluded.has(sourcePath));
    const mapped = sourceFiles
      .map((sourcePath) => ({ sourcePath, storageKey: mapLocalPathToStorageKey(sourcePath) }))
      .filter((entry) => entry.storageKey !== null);
    const dbKeys = new Set(docs.map((doc) => doc.storageKey));
    const localKeys = new Set(mapped.map((entry) => entry.storageKey));
    local = {
      available: true,
      sourceFiles: sourceFiles.length,
      mappedFiles: mapped.length,
      unmappedFiles: sourceFiles.filter((sourcePath) => !mapLocalPathToStorageKey(sourcePath)),
      excludedFiles: [...excluded].sort(),
      missingDatabaseRows: mapped.filter((entry) => !dbKeys.has(entry.storageKey)),
      databaseRowsWithoutLocalSource: docs
        .filter((doc) => !localKeys.has(doc.storageKey))
        .map((doc) => ({ title: doc.title, storageKey: doc.storageKey })),
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    activeEmbeddingModel: activeModel,
    documents: {
      total: docs.length,
      active: docs.filter((doc) => doc.isActive).length,
      retrievable: retrievable.length,
      retrievableMissingEmbedding: docsMissingEmbedding.map((doc) => doc.storageKey),
      retrievableStaleModel: docsStaleModel.map((doc) => doc.storageKey),
      retrievableWithStaleChunks: docsWithStaleChunks.map((doc) => ({
        storageKey: doc.storageKey,
        staleChunks: doc.staleChunkEmbeddings,
      })),
      retrievableWithNoChunks: docsWithNoChunks.map((doc) => doc.storageKey),
      duplicateTitles: duplicateTitles(docs),
    },
    memories: memories[0],
    localSources: local,
  };

  const documentEmbeddingRepairs = new Set([
    ...report.documents.retrievableMissingEmbedding,
    ...report.documents.retrievableStaleModel,
  ]).size;
  // staleEmbedding includes null/missing model provenance, so count it once.
  const strictFailures = documentEmbeddingRepairs
    + report.documents.retrievableWithStaleChunks.length
    + report.memories.staleEmbedding
    + (local.available ? local.missingDatabaseRows.length : 0);

  if (args.json) {
    console.log(JSON.stringify({ ...report, strictFailures }, null, 2));
  } else {
    console.log("\nVisionQuest Sage Index Integrity");
    console.log(`Active embedding model: ${activeModel}`);
    console.log(`Documents: ${docs.length} total, ${retrievable.length} retrievable`);
    console.log(`  missing/stale doc embeddings: ${docsMissingEmbedding.length}/${docsStaleModel.length}`);
    console.log(`  retrievable docs with stale chunks: ${docsWithStaleChunks.length}`);
    console.log(`  retrievable docs with no chunks (summary fallback): ${docsWithNoChunks.length}`);
    console.log(`Memories: ${memories[0].active} active, ${memories[0].staleEmbedding} stale, ${memories[0].missingEmbedding} missing embeddings`);
    console.log(`Duplicate active titles: ${report.documents.duplicateTitles.length} (storage keys retained for disambiguation)`);
    if (local.available) {
      console.log(`Local sources: ${local.sourceFiles} indexable files, ${local.mappedFiles} mapped`);
      console.log(`  mapped files missing DB rows: ${local.missingDatabaseRows.length}`);
      console.log(`  DB rows without local source: ${local.databaseRowsWithoutLocalSource.length}`);
      console.log(`  unmapped local files: ${local.unmappedFiles.length}`);
    } else {
      console.log("Local sources: docs-upload unavailable (coverage check skipped)");
    }
    console.log(`Strict failures: ${strictFailures}`);
  }

  if (args.strict && strictFailures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Integrity audit failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
