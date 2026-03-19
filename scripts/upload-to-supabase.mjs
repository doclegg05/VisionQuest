/**
 * VisionQuest — Supabase Storage Batch Upload Script
 *
 * Uses the same AWS S3-compatible client as the app (storage.ts).
 * Supabase exposes an S3-compatible endpoint — no extra packages needed.
 *
 * SETUP (one-time):
 *   1. Supabase Dashboard → Project Settings → S3 Access
 *   2. Click "Enable S3 Access" if not already on
 *   3. Generate an S3 Access Key → copy Access Key ID and Secret
 *   4. Set these env vars in PowerShell before running:
 *
 *      $env:STORAGE_ACCESS_KEY="your-access-key-id"
 *      $env:STORAGE_SECRET_KEY="your-secret-access-key"
 *
 * USAGE:
 *   node scripts/upload-to-supabase.mjs                      (upload everything)
 *   node scripts/upload-to-supabase.mjs --folder forms       (only forms/ folder)
 *   node scripts/upload-to-supabase.mjs --dry-run            (preview, no upload)
 *
 * The Supabase S3 endpoint for this project is:
 *   https://erdbdpgfirfbaoswwqby.supabase.co/storage/v1/s3
 */

import { readdir, readFile } from "fs/promises";
import { join, relative, extname, dirname } from "path";
import { fileURLToPath } from "url";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PROJECT_REF   = "erdbdpgfirfbaoswwqby";
const SUPABASE_S3   = `https://${PROJECT_REF}.supabase.co/storage/v1/s3`;
const BUCKET        = "Uploads";
const SOURCE_DIR    = join(dirname(fileURLToPath(import.meta.url)), "../docs-upload");

const ACCESS_KEY    = process.env.STORAGE_ACCESS_KEY || "";
const SECRET_KEY    = process.env.STORAGE_SECRET_KEY || "";

// ─── FOLDER MAPPING ──────────────────────────────────────────────────────────
// Local folder → Supabase storage prefix
const FOLDER_MAP = {
  "forms":        "forms",
  "orientation":  "orientation",
  "lms":          "lms",
  "students":     "students/resources",
  "teachers":     "teachers/guides",
  "presentation": "presentations",
};

// ─── MIME TYPES ──────────────────────────────────────────────────────────────
const MIME_MAP = {
  ".pdf":  "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".mp3":  "audio/mpeg",
  ".avi":  "video/x-msvideo",
  ".txt":  "text/plain",
  ".url":  null,  // skip .url shortcut files
  ".ai":   null,  // skip Illustrator source files
};

// ─── CLI ARGS ─────────────────────────────────────────────────────────────────
const args          = process.argv.slice(2);
const DRY_RUN       = args.includes("--dry-run");
const FOLDER_FILTER = args.includes("--folder") ? args[args.indexOf("--folder") + 1] : null;

// ─── HELPERS ─────────────────────────────────────────────────────────────────
async function getAllFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await getAllFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function getStoragePath(localPath) {
  const rel       = relative(SOURCE_DIR, localPath).replace(/\\/g, "/");
  const topFolder = rel.split("/")[0];
  const prefix    = FOLDER_MAP[topFolder];
  if (!prefix) return null;
  const rest = rel.slice(topFolder.length + 1);

  // Section 16 of the handbook appendix = certification module descriptors → lms/
  if (topFolder === "teachers" && rest.includes("Section 16")) {
    const fileName = rest.split("/").pop();
    return `lms/certifications/program-info/${fileName}`;
  }

  return `${prefix}/${rest}`;
}

function getMime(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME_MAP[ext];
  if (mime === null) return null; // explicitly skipped type
  return mime || "application/octet-stream";
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!ACCESS_KEY || !SECRET_KEY) {
    console.error("\n❌  Supabase S3 credentials not set!\n");
    console.error("Steps:");
    console.error("  1. Go to: https://supabase.com/dashboard/project/erdbdpgfirfbaoswwqby/settings/storage");
    console.error("  2. Click 'S3 Connection' → Enable S3 access → Create new access key");
    console.error("  3. In PowerShell, run:");
    console.error("       $env:STORAGE_ACCESS_KEY=\"your-access-key-id\"");
    console.error("       $env:STORAGE_SECRET_KEY=\"your-secret-access-key\"");
    console.error("  4. Then run: node scripts/upload-to-supabase.mjs\n");
    process.exit(1);
  }

  const s3 = new S3Client({
    region:   "us-east-1",
    endpoint: SUPABASE_S3,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    forcePathStyle: true,
  });

  console.log(`\n📦  VisionQuest — Supabase Batch Upload`);
  console.log(`    Bucket:  ${BUCKET}`);
  console.log(`    Source:  docs-upload/`);
  if (FOLDER_FILTER) console.log(`    Filter:  ${FOLDER_FILTER}/ only`);
  if (DRY_RUN) console.log(`    Mode:    DRY RUN (no files uploaded)\n`);
  else console.log(`    Mode:    LIVE UPLOAD\n`);

  const allFiles = await getAllFiles(SOURCE_DIR);
  let uploaded = 0, skipped = 0, errors = 0;
  const errorLog = [];

  for (const filePath of allFiles) {
    const storagePath = getStoragePath(filePath);
    const rel         = relative(SOURCE_DIR, filePath).replace(/\\/g, "/");
    const topFolder   = rel.split("/")[0];
    const mimeType    = getMime(filePath);

    if (!storagePath || mimeType === null) { skipped++; continue; }
    if (FOLDER_FILTER && topFolder !== FOLDER_FILTER) { skipped++; continue; }

    if (DRY_RUN) {
      console.log(`  📄  ${rel}`);
      console.log(`       → ${BUCKET}/${storagePath}`);
      uploaded++;
      continue;
    }

    try {
      const body = await readFile(filePath);
      await s3.send(new PutObjectCommand({
        Bucket:      BUCKET,
        Key:         storagePath,
        Body:        body,
        ContentType: mimeType,
      }));
      console.log(`  ✅  ${rel}`);
      uploaded++;
    } catch (err) {
      console.error(`  ❌  ${rel}  —  ${err.message}`);
      errors++;
      errorLog.push({ file: rel, error: err.message });
    }
  }

  console.log(`\n──────────────────────────────────────`);
  console.log(`  ✅  Uploaded:  ${uploaded} files`);
  console.log(`  ⏭   Skipped:  ${skipped} files`);
  console.log(`  ❌  Errors:   ${errors} files`);
  console.log(`──────────────────────────────────────\n`);

  if (errorLog.length > 0) {
    console.log("Failed files:");
    errorLog.forEach(e => console.log(`  - ${e.file}: ${e.error}`));
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
