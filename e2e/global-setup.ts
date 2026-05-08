import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Minimal `.env.local` loader — Playwright globalSetup doesn't pick up
 * Next.js dotenv conventions, so we manually populate process.env from
 * the project root's `.env.local` (or `.env`) before instantiating Prisma.
 * Existing process.env values win to allow CI/per-run overrides.
 */
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
 * Playwright globalSetup — provisions a known test student in the DB so
 * authenticated E2E specs can log in via the real /api/auth/login flow.
 *
 * Strategy: direct Prisma insert (no public student-registration API exists;
 * the production path is teacher-creates-student which would require
 * provisioning a teacher + classroom first). This is the minimum-viable
 * fixture for one happy-path spec — see e2e/student-authenticated-chat.spec.ts.
 *
 * Credentials are written to e2e/.test-user.json (gitignored) and consumed
 * by the spec. Cleanup happens in global-teardown.ts.
 */

interface TestUserCreds {
  studentDbId: string;
  studentId: string;
  displayName: string;
  email: string;
  password: string;
}

const CREDS_PATH = path.resolve(__dirname, ".test-user.json");

// Mirror src/lib/auth.ts hashPassword() — scrypt format and parameters
// must match exactly so the login route's verifier accepts the hash.
// Keep these constants in sync with SCRYPT_PARAMS in src/lib/auth.ts.
const SCRYPT_PARAMS = {
  N: 1 << 15,
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 64 * 1024 * 1024,
} as const;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(32).toString("hex");
  const derived = crypto
    .scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      maxmem: SCRYPT_PARAMS.maxmem,
    })
    .toString("hex");
  return `scrypt$${salt}$${derived}`;
}

async function globalSetup(): Promise<void> {
  loadDotEnv();
  const prisma = new PrismaClient();
  try {
    const stamp = Date.now();
    const token = crypto.randomBytes(3).toString("hex");
    const studentId = `e2e-auth-${stamp}-${token}`;
    const email = `e2e-auth-${stamp}-${token}@e2e.local`;
    const displayName = `E2E Auth ${token}`;
    const password = `E2eAuth!${stamp}`;

    const created = await prisma.student.create({
      data: {
        studentId,
        displayName,
        email,
        passwordHash: hashPassword(password),
        role: "student",
        isActive: true,
      },
      select: { id: true },
    });

    const creds: TestUserCreds = {
      studentDbId: created.id,
      studentId,
      displayName,
      email,
      password,
    };
    fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2), "utf8");
    console.log(`[e2e setup] Provisioned test student ${studentId}`);
  } finally {
    await prisma.$disconnect();
  }
}

export default globalSetup;
