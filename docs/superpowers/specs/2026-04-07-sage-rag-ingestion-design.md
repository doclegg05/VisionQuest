# Sage RAG Ingestion Pipeline — Design Spec

**Date:** 2026-04-07
**Branch:** feat/phase1-goal-reliability
**Status:** Approved design, pending implementation

## Problem

Sage (the AI coach) has a keyword-based knowledge retrieval pipeline that is fully wired into the chat system prompt — but it has zero documents to retrieve. The `docs-upload/` directory contains 520 SPOKES program files (forms, LMS guides, certification materials, teacher handbooks), and the `docs-upload/sage-context/` directory is empty. Teachers and students get no document-backed answers from Sage.

## Goals

1. Sage can accurately direct students to certifications, programs, and learning platforms offered by SPOKES
2. Sage can accurately direct teachers to the correct forms and program documents
3. Sage includes clickable download links to documents it references
4. Token usage is protected by tiered guardrails (cloud AI) with a kill switch for local AI
5. The system self-manages — no manual maintenance required after initial setup

## Non-Goals

- Embedding-based retrieval (pgvector) — deferred to Phase 2 when corpus exceeds ~200 active documents
- Full-text search within PDFs at query time — Sage uses pre-generated summaries, not raw content
- Student-facing document upload — only the ingestion pipeline and teacher sync populate Sage's knowledge

---

## Architecture

### Section 1: Text Extraction Layer

**New dependency:** `pdf-parse` for PDFs, `mammoth` for DOCX files.

**Module:** `src/lib/sage/extract.ts`

Extracts readable text from binary files before summarization:

| File type | Extraction method | Notes |
|-----------|------------------|-------|
| `.pdf` | `pdf-parse` — first 3 pages | Sufficient for summary; avoids token bloat |
| `.docx` | `mammoth` — full text | Typically short program documents |
| `.png`, `.jpg` | Skip (no text extraction) | Can be overridden via sage-overrides.json |
| `.txt`, `.md` | Direct read | No extraction needed |

**Error handling:** If extraction fails (corrupt file, 0-byte, unsupported format), log the error and skip the file. Never block the entire sync for one bad file.

**PII safety:** Before sending extracted text to Gemini for summarization, apply a lightweight PII scan:
- Reject files containing patterns matching SSN, TANF case numbers, or student names from the database
- Log a warning: `"Skipped [filename]: possible PII detected"`
- Teachers can review and override via the sage-context management UI

### Section 2: Ingestion Engine

**Module:** `src/lib/sage/ingest.ts`

Core function: `syncSageDocuments(options?: { geminiBudget?: number })`

**Folder-to-metadata mapping:**

| Source folder | Category | Audience | Summary strategy |
|---------------|----------|----------|-----------------|
| `forms/` | Inferred from filename patterns | BOTH | Metadata-only |
| `lms/{Platform}/` | LMS_PLATFORM_GUIDE | BOTH | Metadata + cert/platform linking |
| `lms/{Platform}/{Cert}/` | CERTIFICATION_INFO | BOTH | Metadata + cert/platform linking |
| `teachers/` | TEACHER_GUIDE | TEACHER | Gemini summary (multi-topic handbooks) |
| `orientation/` | ORIENTATION | STUDENT | Metadata-only |
| `students/` | STUDENT_RESOURCE | STUDENT | Metadata-only |
| `sage-context/` | AUTO | BOTH | Always Gemini summary |

**Category inference for forms/:** Pattern-match filenames against known prefixes:
- `DFA-*`, `WV Works` -> STUDENT_REFERRAL
- `Authorization*`, `Release*`, `Rights*` -> ORIENTATION
- `Employment_Portfolio*`, `Ready to Work*` -> CERTIFICATION_INFO
- Fallback -> STUDENT_RESOURCE

**Certification/platform linking for lms/:** Map subfolder names to known IDs:
- `GMetrix and LearnKey` -> platformId: `gmetrix-and-learnkey`
- `GMetrix and LearnKey/IC3` -> certificationId: `ic3`, platformId: `gmetrix-and-learnkey`
- `GMetrix and LearnKey/Microsoft Office Specialist (MOS)` -> certificationId: `mos`, platformId: `gmetrix-and-learnkey`
- `Edgenuity` -> platformId: `edgenuity`
- `Essential Education` -> platformId: `essential-education`
- etc.

**Deduplication:** `storageKey` (relative path from `docs-upload/`) is the unique key.

**Change detection:** Compare file size + modification timestamp against stored values. If a file has changed, re-extract and re-summarize. New fields on ProgramDocument:
- Reuse existing `sizeBytes: Int?` field (already on ProgramDocument) — store file size at ingestion time
- `fileModifiedAt: DateTime?` — stores the filesystem mtime at ingestion

**Deletion detection:** Files present in the database but missing from the filesystem are marked `usedBySage: false` (soft disable, not hard delete). Teachers can review orphaned documents in the UI.

**Gemini summary generation:**
- System prompt: `"Summarize this SPOKES program document in 2-3 sentences. Focus on: what it is, when a student or teacher would need it, and which certifications or platforms it relates to. Do not include any student names or personal information."`
- Input: First 3 pages of extracted text (truncated to ~4,000 chars)
- Uses server-side `GEMINI_API_KEY` — no student key involved
- Budget: configurable per call, default 30 for teacher sync, 100 for seed script

**Override file:** `docs-upload/sage-overrides.json` (optional)

```json
{
  "exclude": ["forms/WVAdultEd_Sign_in_sheet_5_2023.pdf"],
  "overrides": {
    "lms/Aztec/Aztecs_Continuum_of_Learning_Chart_1.png": {
      "sageContextNote": "Visual chart showing Aztec learning progression levels"
    }
  }
}
```

Validated with Zod schema at sync time. Malformed JSON logs a warning and is skipped (sync continues without overrides).

### Section 3: Sync API Route & Seed Script

**Endpoint:** `POST /api/teacher/documents/sage-context/sync`

- Auth: teacher or admin role required
- Rate limit: 1 sync per 10 minutes (flat, all roles)
- Calls `syncSageDocuments({ geminiBudget: 30 })`
- Returns: `{ added: number, updated: number, skipped: number, orphaned: number, errors: string[] }`
- Per-file transaction: each file is committed individually. Failures are logged and reported in `errors[]` but do not block other files.

**Seed script:** `scripts/seed-sage-context.ts`

- Calls the same `syncSageDocuments({ geminiBudget: 100 })` logic directly
- Logs progress: `"Batch 1/N: 30 files processed, 2 skipped, 0 errors"`
- Run once: `npx tsx scripts/seed-sage-context.ts`
- Idempotent — safe to re-run (deduplication by storageKey)

**Teacher UI:** "Sync Sage Knowledge" button on the existing sage-context management page. Shows loading spinner during sync, then displays the results summary (added/updated/skipped/errors).

### Section 4: Tiered Usage Guardrails

**Chat rate limits** (`/api/chat/send`):

| Role | Messages/hour | Messages/day |
|------|--------------|-------------|
| Student | 30 | 150 |
| Teacher | 60 | 400 |
| Admin | 120 | Unlimited |

Daily limit uses a second rate limit key: `chat-daily:{userId}` alongside existing `chat:{userId}`.

Rate limit state is stored in the existing `RateLimitEntry` Prisma model (already database-backed, survives deploys).

**Graceful degradation messages:**
- At 80% of daily limit: Sage appends `"I'm getting a lot of questions today — I'll still help, but my answers may be shorter for a bit."`
- At 100% of daily limit: `"I've reached my daily limit. I'll be fresh and ready tomorrow! For urgent questions, please ask your instructor."`

**Kill switch:** Separate env var `DISABLE_RATE_LIMITS=true` (NOT tied to `AI_PROVIDER`).
- When `true`: all chat rate limits and daily caps are disabled
- Logs a startup warning: `"WARNING: Rate limits disabled via DISABLE_RATE_LIMITS=true"`
- `AI_PROVIDER` remains a provider-selection concern only, with no security side effects

### Section 5: Context Flow & Document Linking

**Enhanced `getDocumentContext()` signature:**

```typescript
export async function getDocumentContext(
  userMessage: string,
  maxResults: number = 3
): Promise<string>
```

**Document context format** (injected into system prompt):

```
[Employment Portfolio Checklist FY26]
Link: /api/documents/download?id=clxyz123&mode=view
Summary: Fillable PDF tracking required portfolio documents for job readiness. Students use this throughout the program to collect resume, certifications, and work samples.
```

The `id` field is added to the existing `loadSageDocuments()` select query.

**Token budget:** Total document context injection capped at 2,000 tokens (~8,000 chars). If combined matches exceed this, truncate the last match's summary. Measured by character count / 4 as a rough token estimate.

**maxResults:** Flat 3 for all roles in Phase 1. Tune per-role later based on observed token pressure.

**Sage system prompt addition** (in `personality.ts` guardrails):

> "When you reference a program document that has a Link in your PROGRAM DOCUMENT REFERENCE section, include it as a markdown link so the user can open it directly. Format: [Document Title](/api/documents/download?id=xxx&mode=view). NEVER fabricate or guess document links — only use links that appear in your reference section."

**Download route:** `/api/documents/download?id=xxx&mode=view` already exists with per-request JWT auth and audience-based access control. No changes needed.

---

## Phase 2 Notes (Future)

- **pgvector migration:** When corpus exceeds ~200 active documents, replace keyword scoring in `getDocumentContext()` with embedding-based cosine similarity. Function signature stays the same. ProgramDocument gets an `embedding` vector column.
- **Per-role maxResults tuning:** Monitor token usage in production and adjust if students need fewer or more matches.
- **Incremental sync optimization:** If file count grows significantly, switch from full folder scan to filesystem watcher or checksum-based incremental detection.
- **RAG from sage-context/ files:** Once local AI model is deployed, consider loading full document text at query time instead of pre-generated summaries.

---

## Dependencies

**New npm packages:**
- `pdf-parse` — PDF text extraction
- `mammoth` — DOCX text extraction

**Existing infrastructure used (no changes needed):**
- `ProgramDocument` Prisma model (usedBySage, sageContextNote, storageKey)
- `getDocumentContext()` in `src/lib/sage/knowledge-base.ts`
- `/api/documents/download` route
- `/api/teacher/documents/sage-context` GET/PATCH routes
- `rateLimit()` in `src/lib/rate-limit.ts`
- `invalidatePrefix()` cache busting
- `generateResponse()` in `src/lib/gemini.ts` for Gemini summarization

**Schema changes:**
- Add `fileModifiedAt DateTime?` to ProgramDocument (for change detection)
- Migration: `add_file_modified_at_to_program_document`

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/sage/extract.ts` | Create | Text extraction from PDF/DOCX |
| `src/lib/sage/ingest.ts` | Create | Ingestion engine (scan, classify, summarize, upsert) |
| `src/app/api/teacher/documents/sage-context/sync/route.ts` | Create | POST sync endpoint |
| `scripts/seed-sage-context.ts` | Create | Initial bootstrap script |
| `docs-upload/sage-overrides.json` | Create | Optional override/exclusion config |
| `src/lib/sage/knowledge-base.ts` | Modify | Enhanced getDocumentContext() with links + token budget |
| `src/lib/sage/personality.ts` | Modify | Add document linking instruction to Sage |
| `src/app/api/chat/send/route.ts` | Modify | Add daily rate limit + pass maxResults |
| `prisma/schema.prisma` | Modify | Add fileModifiedAt to ProgramDocument |
