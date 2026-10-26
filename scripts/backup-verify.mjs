#!/usr/bin/env node

/**
 * Read-only recoverable-data check for the evidence-of-record tables.
 *
 * THIS SCRIPT DOES NOT VERIFY BACKUPS. It has no access to Supabase's backup
 * subsystem (daily backups / PITR) — that only exists inside the Supabase
 * dashboard. What it verifies is narrower and more mechanical: that the
 * *live* data a backup would need to capture is actually present right now
 * — non-zero row counts on the tables `docs/DATA_RETENTION_POLICY.md` and
 * the offboarding export flow (`src/lib/student-archive.ts`) depend on, plus
 * whether the configured object-storage backend is reachable and how many
 * objects sit under the `archives/` prefix the export-before-purge rule
 * writes to. A clean run here is necessary but not sufficient evidence that
 * a real restore would succeed — see docs/runbooks/backup-restore.md §5 for
 * the only thing that actually proves that (a tested restore drill).
 *
 * Connects to DATABASE_URL exactly like every other read-only maintenance
 * script in this directory (e.g. scripts/sage-index-integrity.mjs) — no
 * writes, no schema changes, no destructive calls of any kind.
 *
 * Usage:
 *   node scripts/backup-verify.mjs
 *   node scripts/backup-verify.mjs --json
 */

import { PrismaClient } from "@prisma/client";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { loadEnvFile, parseArgs } from "./lib/sage-rag-utils.mjs";

loadEnvFile();

const args = parseArgs();

// Evidence-bearing tables from the task brief. Kept as an explicit list
// (not "every model") so a schema change can't silently narrow what this
// script watches without a reviewer noticing the diff. Parametrized on the
// Prisma client so runBackupVerify() below can point it at a different
// connection (the benchmark suite's prod-readonly URL) than the CLI's
// module-level client.
function evidenceTables(prisma) {
  return [
    { label: "Student", count: () => prisma.student.count() },
    { label: "FormSubmission", count: () => prisma.formSubmission.count() },
    { label: "FileUpload", count: () => prisma.fileUpload.count() },
    { label: "Certification", count: () => prisma.certification.count() },
    { label: "SpokesRecord", count: () => prisma.spokesRecord.count() },
  ];
}

// Mirrors the backend-selection logic in src/lib/storage.ts (STORAGE_* /
// Supabase Storage preferred, R2_* as the live secondary — see the "Do not
// delete: this branch is live, not legacy" comment there). Duplicated
// rather than imported so this script stays a plain-Node .mjs file with no
// TS-loader dependency; if storage.ts's env var names ever change, update
// both places.
const STORAGE_ENDPOINT = process.env.STORAGE_ENDPOINT || "";
const STORAGE_REGION = process.env.STORAGE_REGION || "us-east-1";
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || "";
const STORAGE_ACCESS_KEY = process.env.STORAGE_ACCESS_KEY || "";
const STORAGE_SECRET_KEY = process.env.STORAGE_SECRET_KEY || "";
const HAS_STORAGE_CONFIG = Boolean(
  STORAGE_ENDPOINT && STORAGE_BUCKET && STORAGE_ACCESS_KEY && STORAGE_SECRET_KEY
);

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_BUCKET = process.env.R2_BUCKET_NAME || "";
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY || "";
const R2_SECRET_KEY = process.env.R2_SECRET_KEY || "";
const HAS_R2_CONFIG = Boolean(R2_ACCOUNT_ID && R2_BUCKET && R2_ACCESS_KEY && R2_SECRET_KEY);

// Safety cap on the archive listing — this is metadata-only (ListObjectsV2,
// never GetObject), so even a full listing is cheap, but an unbounded loop
// against a misconfigured bucket shouldn't be able to hang a cron run.
const MAX_ARCHIVE_PAGES = 20;

function buildStorageProbe() {
  if (HAS_STORAGE_CONFIG) {
    return {
      backend: "supabase-storage",
      bucket: STORAGE_BUCKET,
      client: new S3Client({
        region: STORAGE_REGION,
        endpoint: STORAGE_ENDPOINT,
        credentials: { accessKeyId: STORAGE_ACCESS_KEY, secretAccessKey: STORAGE_SECRET_KEY },
        forcePathStyle: true,
      }),
    };
  }

  if (HAS_R2_CONFIG) {
    return {
      backend: "cloudflare-r2",
      bucket: R2_BUCKET,
      client: new S3Client({
        region: "auto",
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
      }),
    };
  }

  return null;
}

/**
 * Counts objects and distinct student directories under the `archives/`
 * prefix — the export-before-purge bundles docs/DATA_RETENTION_POLICY.md
 * requires before any student data is anonymized or deleted. Read-only
 * (ListObjectsV2 metadata calls only; never downloads an object body).
 */
async function probeArchives(probe) {
  let objectCount = 0;
  const studentDirs = new Set();
  let continuationToken;
  let pages = 0;
  let truncated = false;

  do {
    const result = await probe.client.send(
      new ListObjectsV2Command({
        Bucket: probe.bucket,
        Prefix: "archives/",
        ContinuationToken: continuationToken,
      })
    );

    for (const object of result.Contents ?? []) {
      objectCount += 1;
      const studentId = object.Key?.split("/")[1];
      if (studentId) studentDirs.add(studentId);
    }

    continuationToken = result.NextContinuationToken;
    pages += 1;
    if (pages >= MAX_ARCHIVE_PAGES && continuationToken) {
      truncated = true;
      break;
    }
  } while (continuationToken);

  return { objectCount, studentDirCount: studentDirs.size, truncated };
}

/**
 * Importable core: runs the same table-count + storage-probe checks as the
 * CLI, against a given database connection (undefined = Prisma's default
 * env resolution, exactly like the module-level client this replaces), and
 * returns the report object with no printing. Used by the CLI below and by
 * scripts/bench/suites/backup-drill.mjs.
 *
 * @param {string} [databaseUrl] optional connection string override
 * @returns {Promise<{ generatedAt: string, tables: Record<string, number>, storage: object }>}
 */
export async function runBackupVerify(databaseUrl) {
  const prisma = databaseUrl
    ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    : new PrismaClient();

  try {
    const generatedAt = new Date().toISOString();

    const counts = {};
    for (const table of evidenceTables(prisma)) {
      counts[table.label] = await table.count();
    }

    const probe = buildStorageProbe();
    let storage = { configured: false, backend: null, bucket: null, archives: null, error: null };

    if (probe) {
      storage = { configured: true, backend: probe.backend, bucket: probe.bucket, archives: null, error: null };
      try {
        storage.archives = await probeArchives(probe);
      } catch (error) {
        storage.error = error instanceof Error ? error.message : String(error);
      }
    }

    return { generatedAt, tables: counts, storage };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const report = await runBackupVerify();

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const tableSummary = Object.entries(report.tables).map(([label, count]) => `${label}=${count}`).join(" ");
  const storage = report.storage;
  const storageSummary = !storage.configured
    ? "storage=unconfigured"
    : storage.error
      ? `storage=${storage.backend}(error:${storage.error})`
      : `storage=${storage.backend} archives_objects=${storage.archives.objectCount} archives_students=${storage.archives.studentDirCount}${storage.archives.truncated ? "(truncated)" : ""}`;

  // Single dated line — this is the line a cron log should keep.
  console.log(`${report.generatedAt} backup-verify: ${tableSummary} ${storageSummary}`);
}

// Only auto-run when executed directly — importing this module for
// runBackupVerify() (the benchmark suite) must never start a live CLI run.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((error) => {
    console.error(`${new Date().toISOString()} backup-verify FAILED:`, error);
    process.exitCode = 1;
  });
}
