#!/usr/bin/env node

/**
 * Read-only audit of certificationId / platformId coverage + canonicalization
 * on the Sage ProgramDocument corpus.
 *
 * Answers the Sub-project B (metadata-aware doc-RAG) Phase-0 gate: are the
 * metadata tags populated and canonical enough to rank on? Compares the stored
 * values against the canonical taxonomies in src/lib/spokes/certifications.ts
 * and src/lib/spokes/platforms.ts, and flags non-canonical values (ingest.ts is
 * known to write ids like "mos" / "skillpath" that don't match the taxonomy).
 *
 * Non-destructive. Reads only.
 *
 * Usage:
 *   npx tsx scripts/sage-rag-metadata-audit.mjs
 *   npx tsx scripts/sage-rag-metadata-audit.mjs --json
 *   npx tsx scripts/sage-rag-metadata-audit.mjs --out=.planning/sage-rag/B-phase0/metadata-audit.json
 */

import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  ensureParentDir,
  loadEnvFile,
  parseArgs,
  summarizeCounts,
} from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const args = parseArgs();
const prisma = new PrismaClient();

function pct(part, total) {
  if (!total) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function flagValues(counts, canonicalSet) {
  return Object.entries(counts).map(([value, count]) => ({
    value,
    count,
    canonical: canonicalSet.has(value),
  }));
}

async function main() {
  const { CERTIFICATIONS } = await import("../src/lib/spokes/certifications.ts");
  const { PLATFORMS } = await import("../src/lib/spokes/platforms.ts");
  const canonicalCertIds = new Set(CERTIFICATIONS.map((c) => c.id));
  const canonicalPlatformIds = new Set(PLATFORMS.map((p) => p.id));

  const docs = await prisma.programDocument.findMany({
    select: {
      id: true,
      title: true,
      category: true,
      audience: true,
      certificationId: true,
      platformId: true,
      usedBySage: true,
      isActive: true,
    },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });

  // Sub-project B only ranks over docs Sage can actually retrieve.
  const retrievable = docs.filter((doc) => doc.usedBySage && doc.isActive);
  const withCert = retrievable.filter((doc) => doc.certificationId);
  const withPlatform = retrievable.filter((doc) => doc.platformId);
  const withEither = retrievable.filter((doc) => doc.certificationId || doc.platformId);

  const certValues = flagValues(
    summarizeCounts(withCert, (doc) => doc.certificationId),
    canonicalCertIds,
  );
  const platformValues = flagValues(
    summarizeCounts(withPlatform, (doc) => doc.platformId),
    canonicalPlatformIds,
  );

  const categories = [...new Set(retrievable.map((doc) => doc.category))].sort();
  const perCategory = {};
  for (const category of categories) {
    const inCategory = retrievable.filter((doc) => doc.category === category);
    perCategory[category] = {
      total: inCategory.length,
      withCert: inCategory.filter((doc) => doc.certificationId).length,
      withPlatform: inCategory.filter((doc) => doc.platformId).length,
    };
  }

  const nonCanonicalCert = certValues.filter((v) => !v.canonical);
  const nonCanonicalPlatform = platformValues.filter((v) => !v.canonical);

  const report = {
    generatedAt: new Date().toISOString(),
    corpus: {
      totalDocs: docs.length,
      retrievableDocs: retrievable.length,
    },
    coverage: {
      withCertificationId: withCert.length,
      withCertificationIdPct: retrievable.length ? withCert.length / retrievable.length : 0,
      withPlatformId: withPlatform.length,
      withPlatformIdPct: retrievable.length ? withPlatform.length / retrievable.length : 0,
      withEither: withEither.length,
      withEitherPct: retrievable.length ? withEither.length / retrievable.length : 0,
    },
    perCategory,
    certificationValues: certValues,
    platformValues,
    canonicalization: {
      canonicalCertIds: [...canonicalCertIds],
      canonicalPlatformIds: [...canonicalPlatformIds],
      nonCanonicalCertValues: nonCanonicalCert,
      nonCanonicalPlatformValues: nonCanonicalPlatform,
    },
  };

  if (args.out) {
    ensureParentDir(args.out);
    writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("\nVisionQuest Sage RAG — Metadata Coverage & Canonicalization Audit");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(
    `Total docs: ${docs.length}; retrievable (usedBySage && isActive): ${retrievable.length}`,
  );

  console.log("\nCoverage over retrievable docs:");
  console.log(`  certificationId: ${withCert.length} (${pct(withCert.length, retrievable.length)})`);
  console.log(`  platformId:      ${withPlatform.length} (${pct(withPlatform.length, retrievable.length)})`);
  console.log(`  either:          ${withEither.length} (${pct(withEither.length, retrievable.length)})`);

  console.log("\nPer category (retrievable / withCert / withPlatform):");
  for (const [category, value] of Object.entries(perCategory)) {
    console.log(`  ${category}: ${value.total} / ${value.withCert} / ${value.withPlatform}`);
  }

  console.log("\nStored certificationId values (count, canonical?):");
  for (const value of certValues) {
    console.log(`  ${value.value}: ${value.count}${value.canonical ? "" : "   <-- NON-CANONICAL"}`);
  }
  console.log("\nStored platformId values (count, canonical?):");
  for (const value of platformValues) {
    console.log(`  ${value.value}: ${value.count}${value.canonical ? "" : "   <-- NON-CANONICAL"}`);
  }

  if (nonCanonicalCert.length || nonCanonicalPlatform.length) {
    console.log("\n⚠ Non-canonical values found — Track B resolver needs a normalization table:");
    console.log(`  cert: ${nonCanonicalCert.map((v) => v.value).join(", ") || "(none)"}`);
    console.log(`  platform: ${nonCanonicalPlatform.map((v) => v.value).join(", ") || "(none)"}`);
  }

  if (args.out) {
    console.log(`\nWrote JSON report: ${args.out}`);
  }
}

main()
  .catch((error) => {
    console.error("Metadata audit failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
