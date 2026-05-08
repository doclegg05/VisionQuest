import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

function loadDotEnv(): void {
  const candidates = [".env.local", ".env"];
  const root = path.resolve(__dirname, "..");
  for (const filename of candidates) {
    const file = path.join(root, filename);
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

/**
 * Playwright globalTeardown — removes the test student created by
 * global-setup.ts, plus any cascaded data (conversations, messages, goals).
 *
 * Cascade is governed by Prisma `onDelete: Cascade` on the relations
 * declared on Student.
 */

const CREDS_PATH = path.resolve(__dirname, ".test-user.json");

async function globalTeardown(): Promise<void> {
  loadDotEnv();
  if (!fs.existsSync(CREDS_PATH)) return;

  const raw = fs.readFileSync(CREDS_PATH, "utf8");
  const creds = JSON.parse(raw) as { studentDbId?: string };

  if (!creds.studentDbId) {
    fs.rmSync(CREDS_PATH, { force: true });
    return;
  }

  const prisma = new PrismaClient();
  try {
    await prisma.student.delete({ where: { id: creds.studentDbId } });
    console.log(`[e2e teardown] Removed test student ${creds.studentDbId}`);
  } catch (err) {
    console.warn(
      `[e2e teardown] Could not delete test student ${creds.studentDbId}:`,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await prisma.$disconnect();
    fs.rmSync(CREDS_PATH, { force: true });
  }
}

export default globalTeardown;
