import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { GeminiProvider } from "@/lib/ai/gemini-provider";
import { extractText, extractTextFromBuffer, containsPII } from "@/lib/sage/extract";
import { embedProgramDocument } from "@/lib/sage/document-embedding";
import { logger } from "@/lib/logger";
import { invalidatePrefix } from "@/lib/cache";
import { isObjectStorageConfigured, mapLocalPathToStorageKey, storageObjectExists } from "@/lib/storage";
import type { ProgramDocCategory, ProgramDocAudience } from "@prisma/client";

// ─── Overrides schema ────────────────────────────────────────────────────────

const overridesSchema = z.object({
  exclude: z.array(z.string()).default([]),
  overrides: z.record(z.string(), z.object({
    sageContextNote: z.string().optional(),
    category: z.string().optional(),
    certificationId: z.string().optional(),
    platformId: z.string().optional(),
  })).default({}),
}).strict();

type SageOverrides = z.infer<typeof overridesSchema>;

// ─── Folder-to-metadata mapping ──────────────────────────────────────────────

const DOCS_ROOT = path.resolve(process.cwd(), "docs-upload");
const CONFIG_PATH = path.resolve(process.cwd(), "config", "sage-overrides.json");

interface FolderRule {
  category: ProgramDocCategory;
  audience: ProgramDocAudience;
  needsGemini: boolean;
  platformId?: string;
  certificationId?: string;
}

const LMS_PLATFORM_MAP: Record<string, { platformId: string; certificationId?: string }> = {
  "GMetrix and LearnKey": { platformId: "gmetrix-and-learnkey" },
  "GMetrix and LearnKey/IC3": { platformId: "gmetrix-and-learnkey", certificationId: "ic3" },
  "GMetrix and LearnKey/Microsoft Office Specialist (MOS)": { platformId: "gmetrix-and-learnkey", certificationId: "mos" },
  "GMetrix and LearnKey/Intuit": { platformId: "gmetrix-and-learnkey", certificationId: "intuit" },
  "Edgenuity": { platformId: "edgenuity" },
  "Essential Education": { platformId: "essential-education" },
  "Burlington English": { platformId: "burlington-english" },
  "Khan Academy": { platformId: "khan-academy" },
  "Aztec": { platformId: "aztec" },
  "Bring Your A Game to Work": { platformId: "bring-your-a-game", certificationId: "byag" },
  "CSMLearn": { platformId: "csmlearn" },
  "Learning Express": { platformId: "learning-express" },
  "Ready to Work": { platformId: "ready-to-work", certificationId: "rtw" },
  "Through the Customer's Eyes-Customer Service Training": { platformId: "skillpath", certificationId: "customer-service" },
  "USA Learns": { platformId: "usa-learns" },
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const FORM_CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: ProgramDocCategory }> = [
  { pattern: /^DFA[-_]|^WV\s*Works/i, category: "STUDENT_REFERRAL" },
  { pattern: /^Authorization|^Release|^Rights/i, category: "ORIENTATION" },
  { pattern: /^Employment.?Portfolio|^Ready.?to.?Work/i, category: "CERTIFICATION_INFO" },
];

function classifyFile(relativePath: string): FolderRule {
  const parts = relativePath.split("/");
  const topFolder = parts[0];
  const fileName = parts[parts.length - 1];

  switch (topFolder) {
    case "forms": {
      const match = FORM_CATEGORY_PATTERNS.find((p) => p.pattern.test(fileName));
      return {
        category: match?.category ?? "STUDENT_RESOURCE",
        audience: "BOTH",
        needsGemini: false,
      };
    }
    case "lms": {
      const lmsSubPath = parts.slice(1, -1).join("/");
      const mapping = LMS_PLATFORM_MAP[lmsSubPath];

      if (mapping) {
        return {
          category: mapping.certificationId ? "CERTIFICATION_INFO" : "LMS_PLATFORM_GUIDE",
          audience: "BOTH",
          needsGemini: false,
          ...mapping,
        };
      }

      if (parts.length > 2) {
        return {
          category: "LMS_PLATFORM_GUIDE",
          audience: "BOTH",
          needsGemini: false,
          platformId: slugify(parts[1]),
        };
      }

      return { category: "CERTIFICATION_INFO", audience: "BOTH", needsGemini: false };
    }
    case "teachers":
      return { category: "TEACHER_GUIDE", audience: "TEACHER", needsGemini: true };
    case "orientation":
      return { category: "ORIENTATION", audience: "STUDENT", needsGemini: false };
    case "students":
      return { category: "STUDENT_RESOURCE", audience: "STUDENT", needsGemini: false };
    case "presentation":
      return { category: "STUDENT_RESOURCE", audience: "BOTH", needsGemini: false };
    case "sage-context":
      return { category: "SAGE_CONTEXT", audience: "BOTH", needsGemini: true };
    default:
      return { category: "STUDENT_RESOURCE", audience: "BOTH", needsGemini: false };
  }
}

// ─── Metadata summary and MIME helpers ───────────────────────────────────────

function buildMetadataSummary(
  relativePath: string,
  rule: FolderRule,
): string {
  const fileName = path.basename(relativePath, path.extname(relativePath));
  const title = fileName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const parts: string[] = [title];

  if (rule.certificationId) {
    parts.push(`Related certification: ${rule.certificationId}`);
  }
  if (rule.platformId) {
    parts.push(`Platform: ${rule.platformId}`);
  }
  parts.push(`Category: ${rule.category}`);

  return parts.join(". ") + ".";
}

function titleFromPath(relativePath: string): string {
  const fileName = path.basename(relativePath, path.extname(relativePath));
  return fileName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function mimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  return map[ext] ?? "application/octet-stream";
}

// ─── Gemini summarization helper ─────────────────────────────────────────────

const SUMMARIZE_PROMPT = `Summarize this SPOKES program document in 2-3 sentences. Focus on: what it is, when a student or teacher would need it, and which certifications or platforms it relates to. Do not include any student names or personal information.`;

async function generateSummary(
  text: string,
  provider: GeminiProvider,
): Promise<string | null> {
  try {
    const result = await provider.generateResponse(
      SUMMARIZE_PROMPT,
      [{ role: "user", content: text }],
    );
    return result?.trim() || null;
  } catch (error) {
    logger.error("Gemini summarization failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main sync function ───────────────────────────────────────────────────────

export interface SyncOptions {
  geminiBudget?: number;
  onProgress?: (msg: string) => void;
}

// File types the uploader never uploads (see MIME_MAP nulls in
// scripts/upload-to-supabase.mjs) — indexing them would guarantee orphans.
const NEVER_UPLOADED_EXTENSIONS = new Set([".url", ".ai"]);

export interface SyncResult {
  added: number;
  updated: number;
  skipped: number;
  orphaned: number;
  /** Local paths with no bucket key convention (unmapped folder / root file). */
  unmapped: string[];
  /** Mapped paths refused because no object exists in the bucket for the key. */
  missingObjects: string[];
  errors: string[];
}

async function loadOverrides(): Promise<SageOverrides> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    return overridesSchema.parse(JSON.parse(raw));
  } catch {
    return { exclude: [], overrides: {} };
  }
}

async function collectFiles(dir: string, prefix: string = ""): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    // Mirror scripts/upload-to-supabase.mjs: _-prefixed and dotfiles are
    // never uploaded, so they must never be indexed either.
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path.join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }

  return files;
}

/**
 * Ingest program documents from the docs-upload tree into Sage's RAG index.
 *
 * FERPA boundary: this pipeline is for **non-PII program documents only**
 * (handbooks, certification guides, dress-code policies, etc.). It uses
 * the cloud Gemini provider for summary generation, which is allowed
 * here because the inputs must not contain student records. The
 * containsPII() guard below scans extracted text and skips any file
 * that trips the heuristic — but it is a safety net, not a license to
 * point this pipeline at student data. Keep docs-upload restricted to
 * program-level content.
 */
export async function syncSageDocuments(
  options: SyncOptions = {},
): Promise<SyncResult> {
  const { geminiBudget = 30, onProgress } = options;
  const log = onProgress ?? ((msg: string) => logger.info(msg));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for Sage document sync");
  }
  const gemini = new GeminiProvider(apiKey);

  if (!isObjectStorageConfigured()) {
    throw new Error(
      "Object storage is not configured — Sage document sync requires STORAGE_*/R2_* credentials to verify bucket objects before indexing."
    );
  }

  try {
    await fs.access(DOCS_ROOT);
  } catch {
    throw new Error(
      "docs-upload/ tree not found — Sage document sync must run from a checkout that includes the local docs-upload directory (it is gitignored and absent on Render)."
    );
  }

  const overrides = await loadOverrides();
  const allFiles = await collectFiles(DOCS_ROOT);
  const result: SyncResult = {
    added: 0, updated: 0, skipped: 0, orphaned: 0,
    unmapped: [], missingObjects: [], errors: [],
  };

  const seenKeys = new Set<string>();
  let geminiUsed = 0;

  for (let i = 0; i < allFiles.length; i++) {
    const relativePath = allFiles[i];

    const ext = path.extname(relativePath).toLowerCase();
    if (NEVER_UPLOADED_EXTENSIONS.has(ext)) {
      result.skipped++;
      continue;
    }

    // Bucket keys follow the uploader FOLDER_MAP convention, not raw local paths.
    const storageKey = mapLocalPathToStorageKey(relativePath);
    if (!storageKey) {
      result.unmapped.push(relativePath);
      log(`Skipped ${relativePath}: no bucket key convention for this folder`);
      continue;
    }
    seenKeys.add(storageKey);

    if (overrides.exclude.includes(relativePath)) {
      result.skipped++;
      continue;
    }

    try {
      const fullPath = path.join(DOCS_ROOT, relativePath);
      const stat = await fs.stat(fullPath);
      const fileSizeBytes = stat.size;
      const fileModifiedAt = stat.mtime;

      const existing = await prisma.programDocument.findUnique({
        where: { storageKey },
        select: { id: true, sizeBytes: true, fileModifiedAt: true, sageContextNote: true },
      });

      // Unchanged files skip regardless of isActive/usedBySage — curation
      // (including deliberate deactivation) is owned by humans, not the sync.
      if (
        existing &&
        existing.sizeBytes === fileSizeBytes &&
        existing.fileModifiedAt?.getTime() === fileModifiedAt.getTime()
      ) {
        result.skipped++;
        continue;
      }

      // Refuse to index anything without a real bucket object — a row whose
      // download 404s in prod is worse than no row (orphan set C, 2026-07-03).
      if (!(await storageObjectExists(storageKey))) {
        result.missingObjects.push(relativePath);
        log(`Refused ${relativePath}: no bucket object at ${storageKey} — upload first (scripts/upload-to-supabase.mjs)`);
        continue;
      }

      const rule = classifyFile(relativePath);
      const title = titleFromPath(relativePath);
      const mimeType = mimeFromExt(relativePath);

      const override = overrides.overrides[relativePath];

      // Note precedence: explicit override > existing (possibly teacher-edited)
      // note > generated. Regeneration only happens for rows with no note yet.
      let sageContextNote: string | null =
        override?.sageContextNote ?? existing?.sageContextNote ?? null;

      if (!sageContextNote) {
        if (rule.needsGemini && geminiUsed < geminiBudget) {
          const extraction = await extractText(fullPath);
          if (extraction?.text) {
            if (containsPII(extraction.text)) {
              log(`Skipped ${relativePath}: possible PII detected`);
              result.errors.push(`${relativePath}: possible PII detected`);
              continue;
            }
            sageContextNote = await generateSummary(extraction.text, gemini);
            geminiUsed++;
            await delay(500);
          }
        }

        if (!sageContextNote) {
          sageContextNote = buildMetadataSummary(relativePath, rule);
        }
      }

      const data = {
        title,
        storageKey,
        mimeType,
        sizeBytes: fileSizeBytes,
        fileModifiedAt,
        category: (override?.category as ProgramDocCategory) ?? rule.category,
        audience: rule.audience,
        certificationId: override?.certificationId ?? rule.certificationId ?? null,
        platformId: override?.platformId ?? rule.platformId ?? null,
        sageContextNote,
      };

      // Update never touches usedBySage/isActive — those are teacher-curated
      // via PATCH /api/teacher/documents/sage-context and must survive syncs.
      const before = existing ? "update" : "create";
      const saved = await prisma.programDocument.upsert({
        where: { storageKey },
        update: data,
        create: { ...data, usedBySage: true, isActive: true },
        select: { id: true },
      });
      if (before === "update") {
        result.updated++;
      } else {
        result.added++;
      }

      // Embed doc + chunks (Phase 1 semantic RAG). Failures are recorded but
      // never abort the sync loop — the keyword fallback covers unembedded docs.
      try {
        let chunkSourceText: string | null = null;
        if ([".pdf", ".docx", ".txt", ".md"].includes(ext)) {
          const buffer = await fs.readFile(fullPath);
          const chunkExtraction = await extractTextFromBuffer(buffer, ext, {
            maxChars: 12000,
            maxPages: 6,
          });
          const candidate = chunkExtraction?.text ?? null;
          // PII bodies are never embedded; the doc-level vector (title +
          // generated summary) still gets written.
          chunkSourceText = candidate && !containsPII(candidate) ? candidate : null;
        }
        await embedProgramDocument(saved.id, {
          title,
          sageContextNote,
          text: chunkSourceText,
          usage: { studentId: null, callSite: "sage_embedding_ingest" },
        });
      } catch (error) {
        const msg = `${relativePath}: embedding failed — ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(msg);
        logger.error(`Ingestion embedding error: ${msg}`);
      }
    } catch (error) {
      const msg = `${relativePath}: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(msg);
      logger.error(`Ingestion error: ${msg}`);
    }

    if ((i + 1) % 10 === 0) {
      log(`[${i + 1}/${allFiles.length}] ${result.added} added, ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors`);
    }
  }

  const allSageDocKeys = await prisma.programDocument.findMany({
    where: { usedBySage: true, isActive: true },
    select: { storageKey: true },
  });

  for (const doc of allSageDocKeys) {
    if (!seenKeys.has(doc.storageKey)) {
      await prisma.programDocument.update({
        where: { storageKey: doc.storageKey },
        data: { usedBySage: false },
      });
      result.orphaned++;
    }
  }

  invalidatePrefix("sage:documents");

  log(`Sync complete: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped, ${result.orphaned} orphaned, ${result.missingObjects.length} missing objects, ${result.unmapped.length} unmapped, ${result.errors.length} errors`);

  return result;
}
