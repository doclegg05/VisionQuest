import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import { assertSafeE2eSeedTarget } from "../../src/lib/e2e-seed-guard";

/**
 * DB access for specs that must control fixture state (same pattern as
 * placement-bridge.spec.ts, but env-first): prefer the DATABASE_URL already
 * in the environment — CI and hermetic local runs set it inline — and only
 * fall back to parsing .env.local.
 */
export function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const envPath = path.join(__dirname, "..", "..", ".env.local");
  const line = readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("DATABASE_URL="));
  if (!line) {
    throw new Error("DATABASE_URL is not set and not found in .env.local");
  }
  const raw = line.slice("DATABASE_URL=".length).trim();
  const quoted = raw.match(/^(["'])(.*)\1$/);
  return quoted ? quoted[2] : raw;
}

/**
 * A Prisma client for a spec that writes fixture state -- guarded.
 *
 * Every spec that reaches the database through this helper writes to it:
 * placement-bridge.spec.ts flips `placement_bridge_classes`, and the Connect
 * journey flips `connect_enabled_classes` too. Those are global SystemConfig
 * rows, not per-test fixtures, so a run pointed at the wrong database does not
 * fail loudly -- it silently closes a feature for the real pilot class. The
 * owner's `.env.local` DATABASE_URL IS production, and `resolveDatabaseUrl()`
 * falls back to reading exactly that file, so "the wrong database" is the
 * default outcome of running these specs on their machine without thinking
 * about it.
 *
 * The guard lives here rather than in each spec so a spec added later inherits
 * it. There is no `--allow-remote` escape: a Playwright spec has no argv worth
 * consulting, and nothing about these specs is safe to run against production.
 */
export function createPrisma(): PrismaClient {
  const databaseUrl = resolveDatabaseUrl();
  assertSafeE2eSeedTarget(databaseUrl, { allowRemote: false });
  return new PrismaClient({ datasourceUrl: databaseUrl });
}

/**
 * Reset a student to true "day-1" state: no goals, conversations,
 * progression, or orientation progress. Shared by scripts/seed-e2e-users.ts
 * and e2e/student-journey.spec.ts so both enforce the same definition of
 * day-1. Recovery questions are intentionally kept — without them the
 * (student) layout forces /recovery-setup.
 */
export async function resetStudentToDayOne(
  prisma: PrismaClient,
  studentDbId: string,
): Promise<void> {
  await prisma.goal.deleteMany({ where: { studentId: studentDbId } });
  await prisma.conversation.deleteMany({ where: { studentId: studentDbId } });
  await prisma.progressionEvent.deleteMany({ where: { studentId: studentDbId } });
  await prisma.progression.deleteMany({ where: { studentId: studentDbId } });
  await prisma.orientationProgress.deleteMany({ where: { studentId: studentDbId } });
}
