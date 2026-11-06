#!/usr/bin/env node
/**
 * Organization tree preflight: counts only, read only.
 *
 * Run from the Terminal panel before deploying the organization tree branch:
 *   node scripts/org-tree-preflight.mjs
 *
 * Needs ADMIN_DATABASE_URL (the postgres-role string). Refuses to run without it.
 * Every count runs inside one READ ONLY transaction. Output is a label and an
 * integer per line; no names, emails or ids are ever selected.
 *
 * Exit codes: 0 done, 2 no ADMIN_DATABASE_URL, 1 query failure.
 */

import { PrismaClient } from "@prisma/client";
import { loadEnvFile } from "./lib/sage-rag-utils.mjs";
import { PREFLIGHT_COUNTS, formatCounts, isSelectOnly } from "./lib/org-tree-preflight.mjs";

loadEnvFile();

const url = process.env.ADMIN_DATABASE_URL;
if (!url) {
  console.error("Refusing to run: ADMIN_DATABASE_URL is not set. It must be the postgres-role connection string.");
  process.exit(2);
}
for (const { sql } of PREFLIGHT_COUNTS) {
  if (!isSelectOnly(sql)) {
    console.error("Refusing to run: a preflight statement is not a single SELECT.");
    process.exit(2);
  }
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

try {
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const out = [];
    for (const { label, sql } of PREFLIGHT_COUNTS) {
      const result = await tx.$queryRawUnsafe(sql);
      out.push({ label, n: Number(result[0].n) });
    }
    return out;
  });
  console.log(formatCounts(rows));
} catch (error) {
  console.error(`Preflight failed: ${error instanceof Error ? error.constructor.name : "unknown error"}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
