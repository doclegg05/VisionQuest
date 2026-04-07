# Sage RAG Ingestion Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Sage's existing keyword-based retrieval pipeline to 520+ SPOKES program documents via an automated ingestion engine, with document linking in chat responses and tiered rate limiting.

**Architecture:** A text extraction layer reads PDFs/DOCX from `docs-upload/`, an ingestion engine classifies and summarizes them into `ProgramDocument` rows, and the existing `getDocumentContext()` function is enhanced to include download links and respect token budgets. A teacher-triggered sync endpoint and seed script share the same ingestion logic.

**Tech Stack:** Next.js 16 App Router, Prisma 6, Google Gemini 2.5 Flash, pdf-parse, mammoth, Zod

**Spec:** `docs/superpowers/specs/2026-04-07-sage-rag-ingestion-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/sage/extract.ts` | **Create** — Text extraction from PDF/DOCX/TXT + PII scan |
| `src/lib/sage/ingest.ts` | **Create** — Folder scanning, metadata classification, Gemini summarization, ProgramDocument upsert |
| `src/app/api/teacher/documents/sage-context/sync/route.ts` | **Create** — POST endpoint for teacher-triggered sync |
| `scripts/seed-sage-context.mjs` | **Create** — CLI seed script calling ingest logic |
| `config/sage-overrides.json` | **Create** — Optional exclusion/override config |
| `src/lib/sage/knowledge-base.ts` | **Modify** — Add `id` to SageDocument, download links in output, token budget, `maxResults` param |
| `src/lib/sage/personality.ts` | **Modify** — Add document linking instruction to Sage guardrails |
| `src/app/api/chat/send/route.ts` | **Modify** — Role-based hourly limits, daily rate limit, kill switch |
| `src/lib/rate-limit.ts` | **Modify** — Add `rateLimitDaily()` with calendar-day window |
| `prisma/schema.prisma` | **Modify** — Add `fileModifiedAt` to ProgramDocument |
| `package.json` | **Modify** — Add `seed:sage-context` script |

---

## Task 1: Schema Migration — Add `fileModifiedAt` to ProgramDocument

**Files:**
- Modify: `prisma/schema.prisma:841` (after `sageContextNote` field)

- [ ] **Step 1: Add the field to the schema**

In `prisma/schema.prisma`, after line 839 (`sageContextNote String? @db.Text`), add:

```prisma
  fileModifiedAt DateTime? // Filesystem mtime at ingestion — for change detection
```

- [ ] **Step 2: Validate the schema**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid."

- [ ] **Step 3: Create the migration**

Run: `npx prisma migrate dev --name add_file_modified_at_to_program_document`
Expected: Migration created and applied successfully.

- [ ] **Step 4: Generate the client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client"

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add fileModifiedAt to ProgramDocument for change detection"
```

---

## Task 2: Text Extraction Layer — `src/lib/sage/extract.ts`

**Files:**
- Create: `src/lib/sage/extract.ts`

- [ ] **Step 1: Create the extraction module**

```typescript
import fs from "fs/promises";
import path from "path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { logger } from "@/lib/logger";

const SSN_PATTERN = /\d{3}-\d{2}-\d{4}/;
const CASE_NUMBER_PATTERN = /\b(case|tanf|wv\s*works)\b.*?\b\d{7,10}\b/i;

export interface ExtractionResult {
  text: string;
  pageCount?: number;
}

/**
 * Extract readable text from a file. Returns null if extraction fails
 * or the file type is unsupported (images, etc.).
 */
export async function extractText(
  filePath: string
): Promise<ExtractionResult | null> {
  const ext = path.extname(filePath).toLowerCase();

  try {
    const stat = await fs.stat(filePath);
    if (stat.size === 0) {
      logger.warn(`Skipped empty file: ${filePath}`);
      return null;
    }

    switch (ext) {
      case ".pdf":
        return await extractPdf(filePath);
      case ".docx":
        return await extractDocx(filePath);
      case ".txt":
      case ".md":
        return { text: await fs.readFile(filePath, "utf-8") };
      default:
        return null; // Unsupported (images, etc.)
    }
  } catch (error) {
    logger.error(`Extraction failed for ${filePath}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function extractPdf(filePath: string): Promise<ExtractionResult | null> {
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer, { max: 3 }); // First 3 pages
  const text = data.text?.trim();
  if (!text) return null;
  return { text: text.slice(0, 4000), pageCount: data.numpages };
}

async function extractDocx(filePath: string): Promise<ExtractionResult | null> {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value?.trim();
  if (!text) return null;
  return { text: text.slice(0, 4000) };
}

/**
 * Lightweight regex-based PII scan. Returns true if PII patterns are detected.
 * Does NOT match student names (too many false positives in form templates).
 */
export function containsPII(text: string): boolean {
  return SSN_PATTERN.test(text) || CASE_NUMBER_PATTERN.test(text);
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/lib/sage/extract.ts 2>&1 || true`

If there are import resolution issues (common with path aliases), that's expected — the full build will resolve them. Check for syntax errors only.

- [ ] **Step 3: Commit**

```bash
git add src/lib/sage/extract.ts
git commit -m "feat: add text extraction layer for PDF/DOCX with PII scan"
```

---

## Task 3: Ingestion Engine — `src/lib/sage/ingest.ts`

**Files:**
- Create: `src/lib/sage/ingest.ts`

- [ ] **Step 1: Create the overrides schema and folder mapping constants**

```typescript
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateResponse } from "@/lib/gemini";
import { extractText, containsPII } from "@/lib/sage/extract";
import { logger } from "@/lib/logger";
import { invalidatePrefix } from "@/lib/cache";
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
      // Build the LMS subfolder path (e.g., "GMetrix and LearnKey/IC3")
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

      // Fallback for unmapped subfolders
      if (parts.length > 2) {
        return {
          category: "LMS_PLATFORM_GUIDE",
          audience: "BOTH",
          needsGemini: false,
          platformId: slugify(parts[1]),
        };
      }

      // Loose files directly in lms/
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
```

- [ ] **Step 2: Create the metadata-based summary generator**

Append to `src/lib/sage/ingest.ts`:

```typescript
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
```

- [ ] **Step 3: Create the Gemini summarization helper**

Append to `src/lib/sage/ingest.ts`:

```typescript
const SUMMARIZE_PROMPT = `Summarize this SPOKES program document in 2-3 sentences. Focus on: what it is, when a student or teacher would need it, and which certifications or platforms it relates to. Do not include any student names or personal information.`;

async function generateSummary(
  text: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const result = await generateResponse(
      apiKey,
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
```

- [ ] **Step 4: Create the main `syncSageDocuments` function**

Append to `src/lib/sage/ingest.ts`:

```typescript
export interface SyncOptions {
  geminiBudget?: number;
  onProgress?: (msg: string) => void;
}

export interface SyncResult {
  added: number;
  updated: number;
  skipped: number;
  orphaned: number;
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
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path.join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }

  return files;
}

export async function syncSageDocuments(
  options: SyncOptions = {},
): Promise<SyncResult> {
  const { geminiBudget = 30, onProgress } = options;
  const log = onProgress ?? ((msg: string) => logger.info(msg));

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for Sage document sync");
  }

  const overrides = await loadOverrides();
  const allFiles = await collectFiles(DOCS_ROOT);
  const result: SyncResult = { added: 0, updated: 0, skipped: 0, orphaned: 0, errors: [] };

  // Track which storageKeys we see on disk — for orphan detection
  const seenKeys = new Set<string>();
  let geminiUsed = 0;

  for (let i = 0; i < allFiles.length; i++) {
    const relativePath = allFiles[i];
    const storageKey = `docs-upload/${relativePath}`;
    seenKeys.add(storageKey);

    // Check exclusions
    if (overrides.exclude.includes(relativePath)) {
      result.skipped++;
      continue;
    }

    try {
      const fullPath = path.join(DOCS_ROOT, relativePath);
      const stat = await fs.stat(fullPath);
      const fileSizeBytes = stat.size;
      const fileModifiedAt = stat.mtime;

      // Check if already ingested and unchanged
      const existing = await prisma.programDocument.findUnique({
        where: { storageKey },
        select: { id: true, sizeBytes: true, fileModifiedAt: true, isActive: true },
      });

      if (existing?.isActive && existing.sizeBytes === fileSizeBytes && existing.fileModifiedAt?.getTime() === fileModifiedAt.getTime()) {
        result.skipped++;
        continue;
      }

      // Classify the file
      const rule = classifyFile(relativePath);
      const title = titleFromPath(relativePath);
      const mimeType = mimeFromExt(relativePath);

      // Check for manual override
      const override = overrides.overrides[relativePath];

      // Generate sageContextNote
      let sageContextNote: string | null = override?.sageContextNote ?? null;

      if (!sageContextNote) {
        if (rule.needsGemini && geminiUsed < geminiBudget) {
          const extraction = await extractText(fullPath);
          if (extraction?.text) {
            if (containsPII(extraction.text)) {
              log(`Skipped ${relativePath}: possible PII detected`);
              result.errors.push(`${relativePath}: possible PII detected`);
              continue;
            }
            sageContextNote = await generateSummary(extraction.text, apiKey);
            geminiUsed++;
            await delay(500); // Avoid API rate limits
          }
        }

        // Fallback to metadata summary
        if (!sageContextNote) {
          sageContextNote = buildMetadataSummary(relativePath, rule);
        }
      }

      // Upsert the document
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
        usedBySage: true,
        sageContextNote,
        isActive: true,
      };

      if (existing) {
        await prisma.programDocument.update({
          where: { storageKey },
          data,
        });
        result.updated++;
      } else {
        await prisma.programDocument.create({ data });
        result.added++;
      }
    } catch (error) {
      const msg = `${relativePath}: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(msg);
      logger.error(`Ingestion error: ${msg}`);
    }

    // Progress logging every 10 files
    if ((i + 1) % 10 === 0) {
      log(`[${i + 1}/${allFiles.length}] ${result.added} added, ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors`);
    }
  }

  // Orphan detection — mark documents whose files no longer exist
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

  // Bust cache so next chat picks up changes
  invalidatePrefix("sage:documents");

  log(`Sync complete: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped, ${result.orphaned} orphaned, ${result.errors.length} errors`);

  return result;
}
```

- [ ] **Step 5: Verify the file compiles**

Run: `npx tsc --noEmit src/lib/sage/ingest.ts 2>&1 || true`

Check for syntax errors. Import alias resolution issues are expected outside a full build.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sage/ingest.ts
git commit -m "feat: add Sage ingestion engine with folder scanning and Gemini summarization"
```

---

## Task 4: Overrides Config File

**Files:**
- Create: `config/sage-overrides.json`

- [ ] **Step 1: Create the config directory and overrides file**

```bash
mkdir -p config
```

Write `config/sage-overrides.json`:

```json
{
  "exclude": [
    "forms/WVAdultEd_Sign_in_sheet_5_2023.pdf"
  ],
  "overrides": {
    "lms/Aztec/Aztecs_Continuum_of_Learning_Chart_1.png": {
      "sageContextNote": "Visual chart showing Aztec learning progression levels and curriculum structure"
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add config/sage-overrides.json
git commit -m "feat: add sage-overrides.json config for ingestion exclusions"
```

---

## Task 5: Sync API Route

**Files:**
- Create: `src/app/api/teacher/documents/sage-context/sync/route.ts`

- [ ] **Step 1: Create the sync route**

```typescript
import { NextResponse } from "next/server";
import { withTeacherAuth } from "@/lib/api-error";
import { rateLimit } from "@/lib/rate-limit";
import { syncSageDocuments } from "@/lib/sage/ingest";
import { logAuditEvent } from "@/lib/audit";

/**
 * POST /api/teacher/documents/sage-context/sync
 *
 * Scans docs-upload/ and ingests new/changed files into ProgramDocument.
 * Rate limited: 1 sync per 10 minutes (all roles).
 */
export const POST = withTeacherAuth(async (session) => {
  // Rate limit: 1 sync per 10 minutes
  const rl = await rateLimit(`sage-sync:global`, 1, 10 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Sync was run recently. Please wait before syncing again." },
      { status: 429 },
    );
  }

  const result = await syncSageDocuments({ geminiBudget: 30 });

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "sage.knowledge_sync",
    targetType: "program_document",
    targetId: "bulk",
    summary: `Sage knowledge sync: ${result.added} added, ${result.updated} updated, ${result.orphaned} orphaned, ${result.errors.length} errors.`,
    metadata: { ...result, errors: result.errors.slice(0, 10) },
  });

  return NextResponse.json({ success: true, result });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/teacher/documents/sage-context/sync/route.ts
git commit -m "feat: add POST /api/teacher/documents/sage-context/sync endpoint"
```

---

## Task 6: Seed Script

**Files:**
- Create: `scripts/seed-sage-context.mjs`
- Modify: `package.json` (add script)

- [ ] **Step 1: Create the seed script**

```javascript
/**
 * Seed script for initial Sage knowledge base population.
 * Run: node scripts/seed-sage-context.mjs
 *
 * Idempotent — safe to re-run. Skips already-ingested files.
 */

import "dotenv/config";

// Dynamic import to support ESM + path aliases via tsx
const { syncSageDocuments } = await import("../src/lib/sage/ingest.ts");

console.log("Starting Sage knowledge base seed...\n");

try {
  const result = await syncSageDocuments({
    geminiBudget: 100,
    onProgress: (msg) => console.log(msg),
  });

  console.log("\n=== Seed Complete ===");
  console.log(`  Added:    ${result.added}`);
  console.log(`  Updated:  ${result.updated}`);
  console.log(`  Skipped:  ${result.skipped}`);
  console.log(`  Orphaned: ${result.orphaned}`);
  console.log(`  Errors:   ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log("\nErrors:");
    result.errors.forEach((e) => console.log(`  - ${e}`));
  }

  process.exit(0);
} catch (error) {
  console.error("Seed failed:", error);
  process.exit(1);
}
```

- [ ] **Step 2: Add the script to package.json**

In `package.json`, inside the `"scripts"` object, add:

```json
"seed:sage-context": "node scripts/seed-sage-context.mjs"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-sage-context.mjs package.json
git commit -m "feat: add seed script for initial Sage knowledge base population"
```

---

## Task 7: Enhanced `getDocumentContext()` with Links and Token Budget

**Files:**
- Modify: `src/lib/sage/knowledge-base.ts:366-510`

- [ ] **Step 1: Update the `SageDocument` interface and loader**

In `src/lib/sage/knowledge-base.ts`, replace the `SageDocument` interface and `loadSageDocuments()` (lines 366-385):

```typescript
interface SageDocument {
  id: string;
  title: string;
  sageContextNote: string | null;
  certificationId: string | null;
  platformId: string | null;
}

async function loadSageDocuments(): Promise<SageDocument[]> {
  return cached("sage:documents", 300, () =>
    prisma.programDocument.findMany({
      where: { usedBySage: true, isActive: true },
      select: {
        id: true,
        title: true,
        sageContextNote: true,
        certificationId: true,
        platformId: true,
      },
    }),
  );
}
```

- [ ] **Step 2: Update the scored types and `getDocumentContext()` function**

Replace the `getDocumentContext()` function and its scored types (lines 469-510):

```typescript
const TOKEN_BUDGET_CHARS = 6000; // ~2,000 tokens at ~3 chars/token for Gemini

export async function getDocumentContext(
  userMessage: string,
  maxResults: number = 3,
): Promise<string> {
  const messageLower = userMessage.toLowerCase();

  const [docs, snippets] = await Promise.all([
    loadSageDocuments(),
    loadSageSnippets(),
  ]);

  type ScoredDoc = { type: "doc"; id: string; label: string; content: string; score: number };
  type ScoredSnippet = { type: "snippet"; label: string; content: string; score: number };
  type ScoredEntry = ScoredDoc | ScoredSnippet;

  const scoredDocs: ScoredEntry[] = docs
    .map((doc) => ({
      type: "doc" as const,
      id: doc.id,
      label: doc.title,
      content: doc.sageContextNote || doc.title,
      score: scoreDocument(doc, messageLower),
    }))
    .filter((entry) => entry.score > 0);

  const scoredSnippets: ScoredEntry[] = snippets
    .map((snippet) => ({
      type: "snippet" as const,
      label: `Q&A: ${snippet.question}`,
      content: snippet.answer,
      score: scoreSnippet(snippet, messageLower),
    }))
    .filter((entry) => entry.score > 0);

  let combined = [...scoredDocs, ...scoredSnippets]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  if (combined.length === 0) return "";

  // Enforce token budget — drop lowest-scoring entries until under budget
  let totalChars = combined.reduce((sum, e) => sum + formatEntry(e).length, 0);
  while (totalChars > TOKEN_BUDGET_CHARS && combined.length > 1) {
    combined = combined.slice(0, -1);
    totalChars = combined.reduce((sum, e) => sum + formatEntry(e).length, 0);
    logger.debug("Document context: dropped entry to stay within token budget");
  }

  const content = combined.map(formatEntry).join("\n\n");

  return `\n\nPROGRAM DOCUMENT REFERENCE (use this for specific, accurate answers about program materials):\n${content}`;
}

function formatEntry(entry: ScoredDoc | ScoredSnippet): string {
  if (entry.type === "doc") {
    return `[${entry.label}]\nLink: /api/documents/download?id=${entry.id}&mode=view\nSummary: ${entry.content}`;
  }
  return `[${entry.label}]: ${entry.content}`;
}
```

- [ ] **Step 3: Add logger import if not already present**

Check if `logger` is imported at the top of `knowledge-base.ts`. If not, add:

```typescript
import { logger } from "@/lib/logger";
```

- [ ] **Step 4: Verify the build**

Run: `npx eslint src/lib/sage/knowledge-base.ts`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sage/knowledge-base.ts
git commit -m "feat: enhance getDocumentContext with download links and token budget"
```

---

## Task 8: Sage Document Linking Instruction

**Files:**
- Modify: `src/lib/sage/personality.ts:34-42` (GUARDRAILS constant)

- [ ] **Step 1: Add document linking instruction to GUARDRAILS**

In `src/lib/sage/personality.ts`, at the end of the `GUARDRAILS` template literal (before the closing backtick on line 42), append:

```

DOCUMENT REFERENCES — when applicable:
- When you reference a program document that has a Link in your PROGRAM DOCUMENT REFERENCE section, include it as a markdown link so the user can open it directly
- Format: [Document Title](/api/documents/download?id=xxx&mode=view)
- NEVER fabricate or guess document links — only use links that appear in your PROGRAM DOCUMENT REFERENCE section
- If no relevant document appears in your reference section, answer from your general knowledge without links
```

- [ ] **Step 2: Verify the build**

Run: `npx eslint src/lib/sage/personality.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/sage/personality.ts
git commit -m "feat: add document linking instruction to Sage guardrails"
```

---

## Task 9: Calendar-Day Rate Limit Function

**Files:**
- Modify: `src/lib/rate-limit.ts`

- [ ] **Step 1: Add the `rateLimitDaily()` function**

In `src/lib/rate-limit.ts`, after the existing `rateLimit()` function (after line 73), append:

```typescript
/**
 * Daily rate limit with calendar-day window (resets at midnight UTC).
 * Returns the same RateLimitResult shape as rateLimit().
 */
export async function rateLimitDaily(
  key: string,
  limit: number,
): Promise<RateLimitResult> {
  // Compute next midnight UTC
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  ));
  const windowMs = tomorrow.getTime() - now.getTime();

  return rateLimit(key, limit, windowMs);
}
```

- [ ] **Step 2: Verify the build**

Run: `npx eslint src/lib/rate-limit.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rate-limit.ts
git commit -m "feat: add rateLimitDaily with calendar-day window for chat limits"
```

---

## Task 10: Tiered Chat Rate Limits and Kill Switch

**Files:**
- Modify: `src/app/api/chat/send/route.ts:30-35`

- [ ] **Step 1: Add the imports and rate limit constants**

In `src/app/api/chat/send/route.ts`, add the import for `rateLimitDaily` alongside the existing `rateLimit` import (line 4):

```typescript
import { rateLimit, rateLimitDaily } from "@/lib/rate-limit";
```

- [ ] **Step 2: Replace the rate limit block**

Replace lines 31-35 (the current flat rate limit):

```typescript
  // Rate limit
  const rl = await rateLimit(`chat:${session.id}`, 60, 60 * 60 * 1000);
  if (!rl.success) {
    return new Response(JSON.stringify({ error: "Too many messages. Please wait before sending more." }), { status: 429 });
  }
```

With:

```typescript
  // Rate limits — skip if kill switch is enabled
  const rateLimitsDisabled = process.env.VISIONQUEST_DISABLE_RATE_LIMITS === "true";

  if (!rateLimitsDisabled) {
    // Hourly limit by role
    const hourlyLimit = isTeacher ? (session.role === "admin" ? 120 : 60) : 40;
    const hourlyRl = await rateLimit(`chat:${session.id}`, hourlyLimit, 60 * 60 * 1000);
    if (!hourlyRl.success) {
      return new Response(
        JSON.stringify({ error: "Too many messages this hour. Please wait before sending more." }),
        { status: 429 },
      );
    }

    // Daily limit by role (calendar-day, resets midnight UTC)
    if (session.role !== "admin") {
      const dailyLimit = isTeacher ? 400 : 200;
      const dailyRl = await rateLimitDaily(`chat-daily:${session.id}`, dailyLimit);
      if (!dailyRl.success) {
        return new Response(
          JSON.stringify({ error: "I've reached my daily limit. I'll be fresh and ready tomorrow! For urgent questions, please ask your instructor." }),
          { status: 429 },
        );
      }
    }
  }
```

- [ ] **Step 2b: Add 80% daily warning injection into system prompt**

Later in the same file, just before the document context injection (around the line `const documentContext = await getDocumentContext(userMessage);`), add:

```typescript
  // Inject 80% daily warning into system prompt if approaching daily limit
  if (!rateLimitsDisabled && session.role !== "admin") {
    const dailyLimit = isTeacher ? 400 : 200;
    const dailyCheck = await rateLimitDaily(`chat-daily-check:${session.id}`, dailyLimit);
    // Note: we use remaining from the ACTUAL daily key, not a separate check key.
    // Since we already called rateLimitDaily above, we can check remaining there.
    // Simpler approach: read remaining from the existing call.
  }
```

**Actually — simpler approach.** Capture `dailyRl.remaining` from Step 2's daily limit call and use it later:

In the rate limit block from Step 2, store the remaining count in a variable declared before the `if (!rateLimitsDisabled)` block:

```typescript
  let dailyRemaining: number | null = null;

  if (!rateLimitsDisabled) {
    // ... hourly limit code stays the same ...

    // Daily limit by role
    if (session.role !== "admin") {
      const dailyLimit = isTeacher ? 400 : 200;
      const dailyRl = await rateLimitDaily(`chat-daily:${session.id}`, dailyLimit);
      if (!dailyRl.success) {
        return new Response(
          JSON.stringify({ error: "I've reached my daily limit. I'll be fresh and ready tomorrow! For urgent questions, please ask your instructor." }),
          { status: 429 },
        );
      }
      dailyRemaining = dailyRl.remaining;
    }
  }
```

Then, after the system prompt is built but before streaming (right after `systemPrompt += documentContext;`), add:

```typescript
  // 80% daily warning — inject into system prompt so Sage mentions it naturally
  if (dailyRemaining !== null) {
    const dailyLimit = isStaffRole(session.role) ? 400 : 200;
    const usagePercent = 1 - (dailyRemaining / dailyLimit);
    if (usagePercent >= 0.8) {
      systemPrompt += `\n\n[SYSTEM NOTE: This user has used ${Math.round(usagePercent * 100)}% of their daily message limit. Naturally mention that you're getting a lot of questions today and your answers may be shorter for a bit. Do not make it alarming.]`;
    }
  }
```

- [ ] **Step 3: Verify the build**

Run: `npx eslint src/app/api/chat/send/route.ts`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/chat/send/route.ts
git commit -m "feat: add tiered rate limits with daily caps and kill switch"
```

---

## Task 11: Lint Check and Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run ESLint**

Run: `npx eslint .`
Expected: No errors (warnings acceptable).

- [ ] **Step 2: Run Prisma validate**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid."

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: Build succeeds. Fix any TypeScript or import errors found.

- [ ] **Step 4: Commit any fixes**

If the build required fixes:

```bash
git add -A
git commit -m "fix: resolve build errors from RAG ingestion pipeline"
```

---

## Task 12: Manual Smoke Test

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Server starts at http://localhost:3000 without errors.

- [ ] **Step 2: Test the sync endpoint**

```bash
curl -X POST http://localhost:3000/api/teacher/documents/sage-context/sync \
  -H "Cookie: <teacher-jwt-cookie>"
```

Expected: JSON response with `{ success: true, result: { added: N, ... } }`.

Note: If no teacher session is available, test via the seed script instead (Step 3).

- [ ] **Step 3: Run the seed script**

Run: `npm run seed:sage-context`
Expected: Progress output followed by "=== Seed Complete ===" with added/skipped counts.

- [ ] **Step 4: Verify documents in Sage context**

```bash
curl http://localhost:3000/api/teacher/documents/sage-context \
  -H "Cookie: <teacher-jwt-cookie>"
```

Expected: JSON response with `{ documents: [...] }` containing the ingested documents with `usedBySage: true` and `sageContextNote` populated.

- [ ] **Step 5: Test Sage chat with document reference**

Send a message to Sage that should trigger document retrieval (e.g., "What forms do I need for a new student?" or "Tell me about the IC3 certification").

Expected: Sage's response includes a markdown link like `[IC3 Study Guide](/api/documents/download?id=xxx&mode=view)`.

---

## Post-Implementation Notes

- The seed script should be run once after deployment to populate the initial knowledge base
- Teachers can trigger re-sync via the teacher dashboard to pick up new files
- Monitor the `VISIONQUEST_DISABLE_RATE_LIMITS` env var — it should only be `true` when running a local AI model
- The token budget (2,000 tokens / ~6,000 chars) may need tuning based on observed Gemini context limits
- pgvector migration (Phase 2) replaces `scoreDocument()` internals but keeps the same `getDocumentContext()` signature
