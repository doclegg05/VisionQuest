/**
 * Hermetic ProgramDocument corpus from the git-tracked `catalog/` OKF layer.
 *
 * The nightly benchmark database is migrated and gets the Connect synthetic
 * cohort, but nothing had been creating ProgramDocument rows. sage-grounding
 * calls production getDocumentContext() against that empty table, so every
 * case reported `got: none`. rag-retrieval already documented the gap and
 * opted out to prod-readonly; this seeder is the missing catalog→DB path
 * the design asked for (docs/superpowers/specs/2026-09-05-benchmark-suite-design.md §4.3).
 *
 * Notes only — no PDF bytes, no embeddings. Hybrid FTS and the keyword
 * fallback both search title + sageContextNote, which `buildDocNote` already
 * produces from catalog frontmatter. Safe to run only against local/CI
 * databases (same guard as scripts/bench/seed-cohort.ts).
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const { parseCatalogNode } = await import("../../../src/lib/catalog/parse.ts");
const { buildDocNote } = await import("../../../src/lib/catalog/sync.ts");

const CATALOG_DIRS = ["forms", "documents"];

const PROGRAM_DOC_CATEGORIES = new Set([
  "ORIENTATION",
  "STUDENT_REFERRAL",
  "STUDENT_RESOURCE",
  "TEACHER_GUIDE",
  "TEACHER_LMS_SUPPORT",
  "LMS_PLATFORM_GUIDE",
  "CERTIFICATION_INFO",
  "CERTIFICATION_PREREQ",
  "DOHS_FORM",
  "PROGRAM_POLICY",
  "READY_TO_WORK",
  "SAGE_CONTEXT",
  "PRESENTATION",
]);

const PROGRAM_DOC_AUDIENCES = new Set(["STUDENT", "TEACHER", "BOTH"]);

/** Catalog vq_category values that are not ProgramDocCategory enum members. */
const CATEGORY_ALIASES = {
  onboarding: "ORIENTATION",
  dohs: "DOHS_FORM",
  portfolio: "READY_TO_WORK",
  "certification-tracking": "READY_TO_WORK",
  compliance: "TEACHER_GUIDE",
  platform: "LMS_PLATFORM_GUIDE",
};

export function mapCategory(vqCategory, storageKey) {
  if (PROGRAM_DOC_CATEGORIES.has(vqCategory)) return vqCategory;
  if (CATEGORY_ALIASES[vqCategory]) return CATEGORY_ALIASES[vqCategory];
  if (storageKey.startsWith("orientation/")) return "ORIENTATION";
  if (storageKey.startsWith("forms/")) return "DOHS_FORM";
  if (storageKey.startsWith("teachers/")) return "TEACHER_GUIDE";
  if (storageKey.startsWith("students/")) return "STUDENT_RESOURCE";
  if (storageKey.startsWith("lms/")) return "LMS_PLATFORM_GUIDE";
  if (storageKey.startsWith("presentations/")) return "PRESENTATION";
  return "STUDENT_RESOURCE";
}

function mapAudience(vqAudience) {
  return PROGRAM_DOC_AUDIENCES.has(vqAudience) ? vqAudience : "BOTH";
}

function mimeFromStorageKey(storageKey) {
  const dot = storageKey.lastIndexOf(".");
  const ext = dot === -1 ? "" : storageKey.slice(dot).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (ext === ".md") return "text/markdown";
  if (ext === ".pptx") {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  return "application/octet-stream";
}

function loadApprovedCatalogNodes(repoRoot) {
  const nodes = [];
  for (const dir of CATALOG_DIRS) {
    const abs = join(repoRoot, "catalog", dir);
    if (!existsSync(abs)) continue;
    for (const file of readdirSync(abs)) {
      if (!file.endsWith(".md") || file === "index.md") continue;
      const filePath = `catalog/${dir}/${file}`;
      const node = parseCatalogNode(readFileSync(join(repoRoot, filePath), "utf8"), filePath);
      if (node.frontmatter.vq_status === "approved") nodes.push(node);
    }
  }
  return nodes;
}

function normalizeStorageKey(raw) {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return key.length > 0 ? key : null;
}

/**
 * One ProgramDocument upsert payload per distinct vq_storage_key. Duplicate
 * catalog nodes that share a PDF (portfolio checklist + tracking) merge notes
 * the same way catalog:sync does, so the one row is not clobbered.
 */
export function loadCatalogCorpusRows(repoRoot = process.cwd()) {
  const byKey = new Map();
  for (const node of loadApprovedCatalogNodes(repoRoot)) {
    const storageKey = normalizeStorageKey(node.frontmatter.vq_storage_key);
    if (!storageKey) continue;
    const note = buildDocNote(node);
    const existing = byKey.get(storageKey);
    if (!existing) {
      byKey.set(storageKey, {
        storageKey,
        title: node.frontmatter.title,
        description: (node.frontmatter.description ?? "").trim(),
        sageContextNote: note,
        audience: mapAudience(node.frontmatter.vq_audience),
        category: mapCategory(node.frontmatter.vq_category, storageKey),
        mimeType: mimeFromStorageKey(storageKey),
        vqIds: [node.frontmatter.vq_id],
      });
      continue;
    }
    existing.vqIds.push(node.frontmatter.vq_id);
    if (note && !existing.sageContextNote.includes(note)) {
      existing.sageContextNote = existing.sageContextNote
        ? `${existing.sageContextNote} — ${note}`
        : note;
    }
    if (existing.audience !== mapAudience(node.frontmatter.vq_audience)) {
      existing.audience = "BOTH";
    }
  }
  return [...byKey.values()];
}

export function expectedGroundingStorageKeys(
  fixturePath = join(process.cwd(), "config/sage-chat-eval.json"),
) {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  return [
    ...new Set(
      fixture
        .filter((entry) => entry.family === "grounding")
        .map((entry) => entry.assert?.expectCitationId)
        .filter((key) => typeof key === "string" && key.length > 0),
    ),
  ];
}

export function missingStorageKeys(rows, expected) {
  const have = new Set(rows.map((row) => row.storageKey));
  return expected.filter((key) => !have.has(key));
}

export async function seedCatalogCorpus(options) {
  const { databaseUrl, repoRoot = process.cwd(), log = () => undefined } = options;
  const rows = loadCatalogCorpusRows(repoRoot);
  if (rows.length === 0) {
    throw new Error("catalog/ produced zero ProgramDocument rows — check catalog/forms and catalog/documents.");
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    for (const row of rows) {
      const data = {
        title: row.title,
        description: row.description || null,
        sageContextNote: row.sageContextNote || null,
        audience: row.audience,
        category: row.category,
        mimeType: row.mimeType,
        usedBySage: true,
        isActive: true,
      };
      await prisma.programDocument.upsert({
        where: { storageKey: row.storageKey },
        create: { storageKey: row.storageKey, ...data },
        update: data,
      });
    }
    log(`Seeded ${rows.length} ProgramDocument rows from catalog/.`);
    return { upserted: rows.length, keys: rows.map((row) => row.storageKey) };
  } finally {
    await prisma.$disconnect();
  }
}

export async function missingGroundingKeysInDatabase(options) {
  const expected = options.expected ?? expectedGroundingStorageKeys();
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasourceUrl: options.databaseUrl });
  try {
    const found = await prisma.programDocument.findMany({
      where: { storageKey: { in: expected }, usedBySage: true, isActive: true },
      select: { storageKey: true },
    });
    const have = new Set(found.map((row) => row.storageKey));
    return expected.filter((key) => !have.has(key));
  } finally {
    await prisma.$disconnect();
  }
}
