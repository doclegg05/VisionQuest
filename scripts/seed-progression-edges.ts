#!/usr/bin/env node

/**
 * Seed script — populates ProgressionEdge from the static CERTIFICATIONS
 * prerequisite arrays (issue #140). Safe to run multiple times: upserts on
 * the (fromId, toId, kind) unique key, then prunes rows no longer present in
 * the static set, so the table always mirrors the arrays exactly.
 *
 * A .ts entry (run via tsx, like the test suite): a .mjs entry importing a
 * named export from a .ts module fails to link under the repo's tsx/Node
 * loader combination.
 *
 * Usage:
 *   DATABASE_URL="..." npm run db:seed:progression
 */

import { PrismaClient } from "@prisma/client";
import { syncProgressionEdges } from "../src/lib/progression-edges";

const prisma = new PrismaClient();

async function seed() {
  console.log("Seeding progression edges...");
  const { upserted, pruned } = await syncProgressionEdges(prisma);
  console.log(`  ✓ ${upserted} edges upserted, ${pruned} stale edges pruned`);
}

seed()
  .catch((err) => {
    console.error("Progression-edge seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
