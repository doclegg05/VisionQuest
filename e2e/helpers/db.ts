import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

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

export function createPrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: resolveDatabaseUrl() });
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
