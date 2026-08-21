#!/usr/bin/env node

/**
 * Backfill: rewrite stored CareerDiscovery.nationalClusters entries from the
 * retired 16-cluster National Career Clusters framework to the modernized
 * 14-cluster framework (Advance CTE, Oct 2024).
 *
 * - Legacy names crosswalk to their new cluster; two legacy clusters landing
 *   on the same new cluster merge into ONE entry at the MAX score with the
 *   union of their SPOKES mappings.
 * - Unknown names are passed through unchanged (and reported) — this script
 *   never deletes stored student data.
 * - Rows containing malformed entries or unparseable JSON are left untouched
 *   and reported.
 * - Idempotent: already-canonical rows compare equal and are not rewritten;
 *   a second run reports 0 changes.
 *
 * Usage:
 *   node scripts/backfill-national-clusters.mjs             # dry run (default)
 *   node scripts/backfill-national-clusters.mjs --dry-run   # dry run, explicit
 *   node scripts/backfill-national-clusters.mjs --apply     # write changes
 *
 * DATABASE_URL is taken from the shell, falling back to .env / .env.local.
 * Run with an RLS-exempt connection (the table-owner role used by the seed
 * scripts); the vq_app role without RLS context fails closed and sees 0 rows.
 *
 * The taxonomy tables below are a deliberate copy of
 * src/lib/spokes/national-clusters.ts (an .mjs script cannot import the TS
 * module under plain node). src/lib/spokes/national-clusters.test.ts has a
 * parity test that fails if the two drift.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const CANONICAL_CLUSTERS = [
  "Advanced Manufacturing",
  "Agriculture",
  "Arts, Entertainment, & Design",
  "Construction",
  "Digital Technology",
  "Education",
  "Energy & Natural Resources",
  "Financial Services",
  "Healthcare & Human Services",
  "Hospitality, Events, & Tourism",
  "Management & Entrepreneurship",
  "Marketing & Sales",
  "Public Service & Safety",
  "Supply Chain & Transportation",
];

export const LEGACY_MAP = {
  "Agriculture, Food & Natural Resources": "Agriculture",
  "Architecture & Construction": "Construction",
  "Arts, A/V Technology & Communications": "Arts, Entertainment, & Design",
  "Business Management & Administration": "Management & Entrepreneurship",
  "Education & Training": "Education",
  "Finance": "Financial Services",
  "Government & Public Administration": "Public Service & Safety",
  "Health Science": "Healthcare & Human Services",
  "Hospitality & Tourism": "Hospitality, Events, & Tourism",
  "Human Services": "Healthcare & Human Services",
  "Information Technology": "Digital Technology",
  "Law, Public Safety, Corrections & Security": "Public Service & Safety",
  "Manufacturing": "Advanced Manufacturing",
  "Marketing": "Marketing & Sales",
  // The framework dissolved STEM across clusters; Digital Technology is the
  // chosen coarse home (the retired STEM cluster's only SPOKES mapping was
  // tech-digital). Documented in src/lib/spokes/national-clusters.ts.
  "Science, Technology, Engineering & Mathematics": "Digital Technology",
  "Transportation, Distribution & Logistics": "Supply Chain & Transportation",
};

function clusterLookupKey(name) {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CLUSTER_LOOKUP = new Map();
for (const cluster of CANONICAL_CLUSTERS) {
  CLUSTER_LOOKUP.set(clusterLookupKey(cluster), cluster);
}
for (const [legacy, replacement] of Object.entries(LEGACY_MAP)) {
  CLUSTER_LOOKUP.set(clusterLookupKey(legacy), replacement);
}

export function normalizeName(name) {
  const key = clusterLookupKey(name);
  if (!key) return null;
  return CLUSTER_LOOKUP.get(key) ?? null;
}

/**
 * Mirror of normalizeNationalClusterScores() in
 * src/lib/spokes/national-clusters.ts — same rename, MAX-score merge,
 * SPOKES-union, first-appearance order, unknown pass-through.
 */
export function migrateClusterEntries(entries) {
  const merged = new Map();
  for (const entry of entries) {
    const canonical = normalizeName(entry.cluster_name);
    const name = canonical ?? entry.cluster_name;
    const existing = merged.get(name);
    if (!existing) {
      merged.set(name, { ...entry, cluster_name: name });
      continue;
    }
    const spokesUnion =
      existing.spokes_mapping || entry.spokes_mapping
        ? [...new Set([...(existing.spokes_mapping ?? []), ...(entry.spokes_mapping ?? [])])]
        : undefined;
    merged.set(name, {
      ...existing,
      score: Math.max(existing.score, entry.score),
      ...(spokesUnion ? { spokes_mapping: spokesUnion } : {}),
    });
  }
  return [...merged.values()];
}

function isWellFormedEntry(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    !Array.isArray(entry) &&
    typeof entry.cluster_name === "string" &&
    typeof entry.score === "number" &&
    (entry.spokes_mapping === undefined ||
      (Array.isArray(entry.spokes_mapping) &&
        entry.spokes_mapping.every((id) => typeof id === "string")))
  );
}

function describeEntries(entries) {
  return entries
    .map((entry) => `${entry.cluster_name} (${entry.score})`)
    .join(", ");
}

function loadEnvFiles() {
  const shellProvidedKeys = new Set(Object.keys(process.env));
  for (const filename of [".env", ".env.local"]) {
    if (!fs.existsSync(filename)) continue;
    const lines = fs.readFileSync(filename, "utf8").split(/\r?\n/);
    for (const line of lines) {
      if (!line || line.trimStart().startsWith("#")) continue;
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) continue;
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (!key || shellProvidedKeys.has(key)) continue;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const known = new Set(["--apply", "--dry-run"]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0 || (apply && args.includes("--dry-run"))) {
    console.error(
      "Usage: node scripts/backfill-national-clusters.mjs [--dry-run | --apply]",
    );
    process.exit(1);
  }

  loadEnvFiles();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  console.log(`Mode: ${apply ? "APPLY (writing changes)" : "DRY RUN (no writes)"}`);

  const counts = {
    total: 0,
    changed: 0,
    unchanged: 0,
    skippedMalformed: 0,
    unknownNames: 0,
  };

  try {
    const rows = await prisma.careerDiscovery.findMany({
      where: { nationalClusters: { not: null } },
      select: { id: true, nationalClusters: true },
      orderBy: { id: "asc" },
    });
    counts.total = rows.length;

    for (const row of rows) {
      let parsed;
      try {
        parsed = JSON.parse(row.nationalClusters);
      } catch {
        counts.skippedMalformed += 1;
        console.log(`SKIP  ${row.id}: nationalClusters is not valid JSON — left untouched`);
        continue;
      }
      if (!Array.isArray(parsed) || !parsed.every(isWellFormedEntry)) {
        counts.skippedMalformed += 1;
        console.log(`SKIP  ${row.id}: malformed cluster entries — left untouched`);
        continue;
      }

      const migrated = migrateClusterEntries(parsed);

      const unknowns = migrated
        .map((entry) => entry.cluster_name)
        .filter((name) => normalizeName(name) === null);
      if (unknowns.length > 0) {
        counts.unknownNames += unknowns.length;
        console.log(
          `WARN  ${row.id}: unknown cluster name(s) passed through: ${unknowns.join(", ")}`,
        );
      }

      if (JSON.stringify(migrated) === JSON.stringify(parsed)) {
        counts.unchanged += 1;
        continue;
      }

      counts.changed += 1;
      console.log(`ROW   ${row.id}`);
      console.log(`  before: ${describeEntries(parsed)}`);
      console.log(`  after:  ${describeEntries(migrated)}`);

      if (apply) {
        await prisma.careerDiscovery.update({
          where: { id: row.id },
          data: { nationalClusters: JSON.stringify(migrated) },
        });
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log("");
  console.log(
    `Summary: ${counts.total} row(s) with nationalClusters — ` +
      `${counts.changed} ${apply ? "rewritten" : "would change"}, ` +
      `${counts.unchanged} already canonical, ` +
      `${counts.skippedMalformed} skipped (malformed), ` +
      `${counts.unknownNames} unknown name(s) passed through`,
  );
  if (!apply && counts.changed > 0) {
    console.log("Dry run only — re-run with --apply to write these changes.");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  });
}
