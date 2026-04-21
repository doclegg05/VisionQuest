#!/usr/bin/env node
// Integration smoke test for Phase 0 of the Supabase optimization plan.
//
// Seeds N pending BackgroundJob rows, then concurrently invokes the atomic
// claim query twice to verify FOR UPDATE SKIP LOCKED prevents double-claim.
//
// USAGE:
//   node scripts/test-concurrent-job-claim.mjs
//
// Requires DATABASE_URL in .env.local (project uses dotenv via Next — this
// script loads it manually). Safe to run against the dev DB — it cleans up
// its own rows. DO NOT run against production.

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local manually (no Next.js runtime here)
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["'](.*)["']$/, "$1");
  }
} catch {
  // Fall back to whatever is in process.env
}

const SEED_TAG = `concurrent-claim-test-${Date.now()}`;
const SEED_COUNT = 5;

const prisma = new PrismaClient();

async function main() {
  console.log(`Seeding ${SEED_COUNT} pending jobs with tag "${SEED_TAG}"...`);
  await prisma.$transaction(
    Array.from({ length: SEED_COUNT }, (_, i) =>
      prisma.backgroundJob.create({
        data: {
          type: SEED_TAG,
          payload: JSON.stringify({ index: i }),
          status: "pending",
          attempts: 0,
        },
      }),
    ),
  );

  const claim = (limit) => prisma.$queryRaw`
    UPDATE visionquest."BackgroundJob"
    SET status = 'processing',
        "startedAt" = NOW(),
        attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM visionquest."BackgroundJob"
      WHERE status = 'pending' AND attempts < 3 AND type = ${SEED_TAG}
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts
  `;

  console.log("Running two concurrent claims of size 5 each...");
  const [a, b] = await Promise.all([claim(5), claim(5)]);

  console.log(`Claim A got ${a.length} jobs; Claim B got ${b.length} jobs.`);
  const ids = new Set();
  for (const job of [...a, ...b]) {
    if (ids.has(job.id)) {
      throw new Error(`DOUBLE CLAIM: job ${job.id} returned by both callers`);
    }
    ids.add(job.id);
  }

  if (ids.size !== SEED_COUNT) {
    throw new Error(
      `Expected ${SEED_COUNT} distinct claimed jobs, got ${ids.size}`,
    );
  }

  console.log(`PASS: ${ids.size} distinct jobs claimed across both callers, zero overlap.`);

  // Cleanup
  console.log("Cleaning up seeded rows...");
  const deleted = await prisma.backgroundJob.deleteMany({ where: { type: SEED_TAG } });
  console.log(`Deleted ${deleted.count} rows.`);
}

main()
  .catch((err) => {
    console.error("FAIL:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
