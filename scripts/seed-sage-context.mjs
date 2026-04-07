/**
 * Seed script for initial Sage knowledge base population.
 * Run: node scripts/seed-sage-context.mjs
 *
 * Idempotent — safe to re-run. Skips already-ingested files.
 */

import "dotenv/config";

// Dynamic import to support ESM + path aliases via tsx
const { syncSageDocuments } = await import("../src/lib/sage/ingest.ts");

console.log("Starting Sage knowledge base seed...\n");

try {
  const result = await syncSageDocuments({
    geminiBudget: 100,
    onProgress: (msg) => console.log(msg),
  });

  console.log("\n=== Seed Complete ===");
  console.log(`  Added:    ${result.added}`);
  console.log(`  Updated:  ${result.updated}`);
  console.log(`  Skipped:  ${result.skipped}`);
  console.log(`  Orphaned: ${result.orphaned}`);
  console.log(`  Errors:   ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log("\nErrors:");
    result.errors.forEach((e) => console.log(`  - ${e}`));
  }

  process.exit(0);
} catch (error) {
  console.error("Seed failed:", error);
  process.exit(1);
}
