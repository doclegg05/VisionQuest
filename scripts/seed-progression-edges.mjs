#!/usr/bin/env node

/**
 * Seed script — populates ProgressionEdge from the static CERTIFICATIONS
 * prerequisite arrays (issue #140). Safe to run multiple times: upserts on
 * the (fromId, toId, kind) unique key, then prunes rows no longer present in
 * the static set, so the table always mirrors the arrays exactly.
 *
 * Usage:
 *   DATABASE_URL="..." npm run db:seed:progression
 */

import { PrismaClient } from "@prisma/client";
import { syncProgressionEdges } from "../src/lib/progression-edges.ts";

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
