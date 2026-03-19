#!/usr/bin/env node

/**
 * Seed script — populates ProgramDocument table from the docs-upload/_inventory.txt.
 * Safe to run multiple times (upserts by storageKey).
 *
 * Usage:
 *   DATABASE_URL="..." node scripts/seed-documents.mjs
 *   node scripts/seed-documents.mjs          (uses .env.local)
 *   node scripts/seed-documents.mjs --dry-run (preview, no DB writes)
 */

import { PrismaClient } from "@prisma/client";
import { readFile } from "fs/promises";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = dirname(fileURLToPath(import.meta.url));
const INVENTORY_PATH = join(ROOT, "../docs-upload/_inventory.txt");

// ─── FOLDER → STORAGE PREFIX (must match upload-to-supabase.mjs) ────────────
const FOLDER_MAP = {
  forms:        "forms",
  orientation:  "orientation",
  lms:          "lms",
  students:     "students/resources",
  teachers:     "teachers/guides",
  presentation: "presentations",
};

// ─── LMS SUBFOLDER → PLATFORM ID (matches platforms.ts) ─────────────────────
const PLATFORM_MAP = {
  "Aztec":                                           "aztec",
  "Bring Your A Game to Work":                       "bring-your-a-game",
  "Burlington English":                              "burlington-english",
  "CSMLearn":                                        "csmlearn",
  "Edgenuity":                                       "edgenuity",
  "Essential Education":                             "essential-education",
  "GMetrix and LearnKey":                            "gmetrix-and-learnkey",
  "Khan Academy":                                    "khan-academy",
  "Learning Express":                                "learning-express-library",
  "Ready to Work":                                   "ready-to-work",
  "Through the Customer's Eyes-Customer Service Training": "through-the-customers-eyes",
  "USA Learns":                                      "usa-learns",
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
};

// Extensions to skip entirely
const SKIP_EXTENSIONS = new Set([".url", ".ai"]);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Parse an inventory line into a relative path from docs-upload/ */
function parseInventoryLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Lines look like: C:\Users\...\docs-upload\forms\file.pdf
  const marker = "docs-upload\\";
  const idx = trimmed.indexOf(marker);
  if (idx === -1) return null;
  return trimmed.slice(idx + marker.length).replace(/\\/g, "/");
}

/** Build the Supabase storageKey from a relative path */
function getStorageKey(relPath) {
  const topFolder = relPath.split("/")[0];
  const prefix = FOLDER_MAP[topFolder];
  if (!prefix) return null;

  const rest = relPath.slice(topFolder.length + 1);

  // Special case: teachers/Hanbook Appendix/Section 16/* → lms/certifications/program-info/*
  if (topFolder === "teachers" && rest.includes("Hanbook Appendix/Section 16/")) {
    const fileName = rest.split("/").pop();
    return `lms/certifications/program-info/${fileName}`;
  }

  return `${prefix}/${rest}`;
}

/** Determine ProgramDocCategory from the relative path */
function getCategory(relPath) {
  const lower = relPath.toLowerCase();
  const topFolder = relPath.split("/")[0];

  if (topFolder === "orientation") return "ORIENTATION";
  if (topFolder === "presentation") return "PRESENTATION";
  if (topFolder === "students") return "STUDENT_RESOURCE";

  if (topFolder === "forms") {
    // Refine forms into sub-categories
    if (/rights|acceptable.?use|dress.?code|non.?discrimination|confidential/i.test(lower))
      return "PROGRAM_POLICY";
    if (/ready.?to.?work|module.?rubric|attendance.?verification|benchmark/i.test(lower))
      return "READY_TO_WORK";
    if (/portfolio|employment.?portfolio/i.test(lower))
      return "READY_TO_WORK";
    return "DOHS_FORM";
  }

  if (topFolder === "lms") {
    const parts = relPath.split("/");
    const subfolder = parts[1] || "";
    if (/ready.?to.?work/i.test(subfolder)) return "READY_TO_WORK";
    return "LMS_PLATFORM_GUIDE";
  }

  if (topFolder === "teachers") {
    // Section 16 = certification module descriptors
    if (lower.includes("section 16")) return "CERTIFICATION_INFO";
    return "TEACHER_GUIDE";
  }

  return "STUDENT_RESOURCE";
}

/** Determine audience from relative path */
function getAudience(relPath) {
  const topFolder = relPath.split("/")[0];
  if (topFolder === "teachers") return "TEACHER";
  if (topFolder === "students") return "STUDENT";
  if (topFolder === "orientation") return "STUDENT";
  return "BOTH";
}

/** Extract platformId for lms/ documents */
function getPlatformId(relPath) {
  const topFolder = relPath.split("/")[0];
  if (topFolder !== "lms") return null;
  const parts = relPath.split("/");
  const subfolder = parts[1] || "";
  return PLATFORM_MAP[subfolder] || null;
}

/** Derive a human-readable title from a filename */
function deriveTitle(filename) {
  // Strip extension
  const ext = extname(filename);
  let title = filename.slice(0, -ext.length);

  // Replace underscores and hyphens with spaces
  title = title.replace(/_/g, " ").replace(/-/g, " ");

  // Remove common version suffixes
  title = title
    .replace(/\s*FY\s*\d{2,4}/gi, "")
    .replace(/\s*Fillable/gi, "")
    .replace(/\s*fillable/gi, "")
    .replace(/\s*Rev[\s.]*[\d\-]+/gi, "")
    .replace(/\s*updated[\s.]*[\d\-]+/gi, "")
    .replace(/\s*v\d+/gi, "")
    .replace(/\s*\(\d+\)/g, "")         // Remove (1), (2) suffixes
    .replace(/\s+/g, " ")
    .trim();

  return title || filename;
}

/** Get MIME type from extension */
function getMimeType(filename) {
  const ext = extname(filename).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

/** Check if file should be skipped */
function shouldSkip(filename) {
  const ext = extname(filename).toLowerCase();
  return SKIP_EXTENSIONS.has(ext);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📚  VisionQuest — Seed Program Documents`);
  if (DRY_RUN) console.log(`    Mode: DRY RUN (no DB writes)\n`);
  else console.log(`    Mode: LIVE\n`);

  const inventoryRaw = await readFile(INVENTORY_PATH, "utf-8");
  const lines = inventoryRaw.split("\n");

  const documents = [];

  for (const line of lines) {
    const relPath = parseInventoryLine(line);
    if (!relPath) continue;

    const filename = relPath.split("/").pop();
    if (!filename || shouldSkip(filename)) continue;

    const storageKey = getStorageKey(relPath);
    if (!storageKey) continue;

    const category = getCategory(relPath);
    const audience = getAudience(relPath);
    const platformId = getPlatformId(relPath);
    const title = deriveTitle(filename);
    const mimeType = getMimeType(filename);

    // For Section 16 mapped to lms/, override audience to BOTH
    const finalAudience =
      relPath.startsWith("teachers/") && relPath.includes("Section 16/")
        ? "BOTH"
        : audience;

    documents.push({
      title,
      storageKey,
      mimeType,
      category,
      audience: finalAudience,
      platformId,
      sortOrder: 0,
      isActive: true,
    });
  }

  console.log(`  Found ${documents.length} documents to seed.\n`);

  if (DRY_RUN) {
    const byCat = {};
    for (const doc of documents) {
      byCat[doc.category] = (byCat[doc.category] || 0) + 1;
    }
    console.log("  By category:");
    for (const [cat, count] of Object.entries(byCat).sort()) {
      console.log(`    ${cat}: ${count}`);
    }
    console.log(`\n  Sample documents:`);
    for (const doc of documents.slice(0, 10)) {
      console.log(`    [${doc.category}] ${doc.title}`);
      console.log(`      storageKey: ${doc.storageKey}`);
      console.log(`      audience: ${doc.audience}, platform: ${doc.platformId || "—"}`);
    }
    return;
  }

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const doc of documents) {
    try {
      const result = await prisma.programDocument.upsert({
        where: { storageKey: doc.storageKey },
        create: doc,
        update: {
          title: doc.title,
          mimeType: doc.mimeType,
          category: doc.category,
          audience: doc.audience,
          platformId: doc.platformId,
        },
      });
      // Check if it was created or updated by comparing createdAt vs updatedAt
      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }
    } catch (err) {
      console.error(`  ❌  ${doc.storageKey}: ${err.message}`);
      errors++;
    }
  }

  console.log(`  ✅  Created: ${created}`);
  console.log(`  🔄  Updated: ${updated}`);
  if (errors > 0) console.log(`  ❌  Errors: ${errors}`);
  console.log();
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
