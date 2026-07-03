/**
 * Seed script for initial Sage knowledge base population.
 * Run: node scripts/seed-sage-context.mjs
 *
 * Idempotent — safe to re-run. Skips already-ingested files.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// Dynamic import to support ESM + path aliases via tsx
const { syncSageDocuments } = await import("../src/lib/sage/ingest.ts");

const DRY_RUN = process.argv.includes("--dry-run");

console.log(`Starting Sage knowledge base seed...${DRY_RUN ? " (DRY RUN — no writes)" : ""}\n`);

try {
  const result = await syncSageDocuments({
    geminiBudget: 100,
    dryRun: DRY_RUN,
    onProgress: (msg) => console.log(msg),
  });

  console.log("\n=== Seed Complete ===");
  console.log(`  Added:            ${result.added}`);
  console.log(`  Updated:          ${result.updated}`);
  console.log(`  Skipped:          ${result.skipped}`);
  console.log(`  Orphaned:         ${result.orphaned}`);
  console.log(`  Missing objects:  ${result.missingObjects.length}`);
  console.log(`  Unmapped:         ${result.unmapped.length}`);
  console.log(`  Errors:           ${result.errors.length}`);

  if (result.missingObjects.length > 0) {
    console.log("\nRefused (no bucket object — upload first):");
    result.missingObjects.forEach((p) => console.log(`  - ${p}`));
  }
  if (result.unmapped.length > 0) {
    console.log("\nUnmapped (no bucket key convention):");
    result.unmapped.forEach((p) => console.log(`  - ${p}`));
  }
  if (result.errors.length > 0) {
    console.log("\nErrors:");
    result.errors.forEach((e) => console.log(`  - ${e}`));
  }

  process.exit(0);
} catch (error) {
  console.error("Seed failed:", error);
  process.exit(1);
}
