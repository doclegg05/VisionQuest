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

**PII safety:** Before sending extracted text to Gemini for summarization, apply a lightweight regex-based PII scan:
- Reject files containing patterns matching SSN (`\d{3}-\d{2}-\d{4}`), TANF/WV Works case numbers (`\b\d{7,10}\b` near keywords "case", "TANF", "WV Works")
- Student name matching is **not** performed (too many false positives with common names in form templates)
- Log a warning: `"Skipped [filename]: possible PII detected"`
- Teachers can review flagged files and override via the sage-context management UI

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
| `presentation/` | STUDENT_RESOURCE | BOTH | Metadata-only |
| `sage-context/` | AUTO | BOTH | Always Gemini summary |

**Category inference for forms/:** Pattern-match filenames against known prefixes:
- `DFA-*`, `WV Works` -> STUDENT_REFERRAL
- `Authorization*`, `Release*`, `Rights*` -> ORIENTATION
- `Employment_Portfolio*`, `Ready to Work*` -> CERTIFICATION_INFO
- Fallback -> STUDENT_RESOURCE

**Certification/platform linking for lms/:** Map subfolder names to known IDs. Unmapped subfolders default to `category: LMS_PLATFORM_GUIDE` with `platformId` derived from the folder name (slugified: spaces to hyphens, lowercase).

Known mappings:
- `GMetrix and LearnKey` -> platformId: `gmetrix-and-learnkey`
- `GMetrix and LearnKey/IC3` -> certificationId: `ic3`, platformId: `gmetrix-and-learnkey`
- `GMetrix and LearnKey/Microsoft Office Specialist (MOS)` -> certificationId: `mos`, platformId: `gmetrix-and-learnkey`
- `GMetrix and LearnKey/Intuit` -> certificationId: `intuit`, platformId: `gmetrix-and-learnkey`
- `Edgenuity` -> platformId: `edgenuity`
- `Essential Education` -> platformId: `essential-education`
- `Burlington English` -> platformId: `burlington-english`
- `Khan Academy` -> platformId: `khan-academy`
- `Aztec` -> platformId: `aztec`
- `Bring Your A Game to Work` -> platformId: `bring-your-a-game`, certificationId: `byag`
- `CSMLearn` -> platformId: `csmlearn`
- `Learning Express` -> platformId: `learning-express`
- `Ready to Work` -> platformId: `ready-to-work`, certificationId: `rtw`
- `Through the Customer's Eyes-Customer Service Training` -> platformId: `skillpath`, certificationId: `customer-service`
- `USA Learns` -> platformId: `usa-learns`

**Fallback rule:** Any LMS subfolder not in the known mappings list is ingested as `LMS_PLATFORM_GUIDE` with a slugified `platformId`. Loose files directly in `lms/` (e.g., `Food Handlers Certification.pdf`) are ingested as `CERTIFICATION_INFO` with no platformId.

**Deduplication:** `storageKey` (relative path from `docs-upload/`) is the unique key.

**Change detection:** Compare file size + modification timestamp against stored values. If a file has changed, re-extract and re-summarize. New fields on ProgramDocument:
- Reuse existing `sizeBytes: Int?` field (already on ProgramDocument) — stores the **local filesystem** file size at ingestion time. This is authoritative for change detection since the ingestion pipeline reads from `docs-upload/` on disk, not from Supabase Storage.
- `fileModifiedAt: DateTime?` — stores the filesystem mtime at ingestion

**Deletion detection:** Files present in the database but missing from the filesystem are marked `usedBySage: false` (soft disable, not hard delete). Teachers can review orphaned documents in the UI.

**Gemini summary generation:**
- System prompt: `"Summarize this SPOKES program document in 2-3 sentences. Focus on: what it is, when a student or teacher would need it, and which certifications or platforms it relates to. Do not include any student names or personal information."`
- Input: First 3 pages of extracted text (truncated to ~4,000 chars)
- Uses server-side `GEMINI_API_KEY` — no student key involved
- Budget: configurable per call, default 30 for teacher sync, 100 for seed script
- **Adapter pattern:** `generateResponse()` in `gemini.ts` expects chat-format args `(apiKey, systemPrompt, messages[])`. The ingestion engine wraps the extracted text as a single-message array: `[{ role: "user", content: extractedText }]`. This keeps the Gemini interface consistent — no new function needed.
- **Concurrency:** Gemini calls run sequentially (one at a time) with a 500ms delay between calls to avoid API rate limits. No parallel summarization. At ~2s per call, 30 summaries take ~75s and 100 summaries take ~250s. Progress is logged after each batch of 10.

**Override file:** `config/sage-overrides.json` (optional, version-controlled)

Stored in `config/` (not `docs-upload/`) so it is tracked in git and deployed consistently across environments.

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

**Seed script:** `scripts/seed-sage-context.mjs`

- Calls the same `syncSageDocuments({ geminiBudget: 100 })` logic directly
- Logs progress using `console.log`: `"[10/52] 10 files processed, 2 skipped, 0 errors"` (scripts use console.log, not the app logger)
- Run once: `node scripts/seed-sage-context.mjs` (matches existing project convention: `seed-data.mjs`, `seed-documents.mjs`)
- Add `"seed:sage-context": "node scripts/seed-sage-context.mjs"` to `package.json` scripts
- Idempotent — safe to re-run (deduplication by storageKey)

**Teacher UI:** "Sync Sage Knowledge" button on the existing sage-context management page. Shows loading spinner during sync, then displays the results summary (added/updated/skipped/errors).

### Section 4: Tiered Usage Guardrails

**Chat rate limits** (`/api/chat/send`):

| Role | Messages/hour | Messages/day |
|------|--------------|-------------|
| Student | 40 | 200 |
| Teacher | 60 | 400 |
| Admin | 120 | Unlimited |

**Breaking change note:** The current codebase applies a flat 60/hr limit for all roles. Students are reduced to 40/hr (from 60). This is intentional — 60/hr for students is unnecessarily high and burns API budget. Teachers retain 60/hr (no change).

Daily limit uses a second rate limit key: `chat-daily:{userId}` alongside existing `chat:{userId}`. The daily window is **calendar-day based** (resets at midnight UTC), not a rolling 24h window. This avoids the confusing UX where a student who hits the limit at 11 PM cannot send messages until 11 PM the next day. Implementation: compute `resetTime` as the next midnight UTC rather than `now + 86400000`.

Rate limit state is stored in the existing `RateLimitEntry` Prisma model (already database-backed, survives deploys).

**Graceful degradation messages:**
- At 80% of daily limit: Sage appends `"I'm getting a lot of questions today — I'll still help, but my answers may be shorter for a bit."`
- At 100% of daily limit: `"I've reached my daily limit. I'll be fresh and ready tomorrow! For urgent questions, please ask your instructor."`

**Kill switch:** Separate env var `VISIONQUEST_DISABLE_RATE_LIMITS=true` (NOT tied to `AI_PROVIDER`).
- When `true`: all chat rate limits and daily caps are disabled
- Logs a startup warning: `"WARNING: Rate limits disabled via VISIONQUEST_DISABLE_RATE_LIMITS=true"`
- `AI_PROVIDER` remains a provider-selection concern only, with no security side effects
- Namespaced with `VISIONQUEST_` to avoid conflicts with other env vars

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

**Type changes required to propagate `id`:**
1. Add `id: true` to `loadSageDocuments()` select query
2. Add `id: string` to the `SageDocument` interface
3. Update the `ScoredDoc` type alias to include `id: string`
4. Pass `id` through in the scored-doc mapping so the output formatter can build the download URL

**SageSnippet output format:** Snippets (teacher Q&A pairs) have no document ID or download link. Their output format remains unchanged: `[Q&A: {question}]: {answer}`. Only `ProgramDocument` entries get the `Link:` field.

**Token budget:** Total document context injection capped at 2,000 tokens. Estimated by counting characters and dividing by 3 (Gemini tokenizer averages ~3 chars/token for English mixed with URLs, more conservative than the typical chars/4 estimate). If combined matches exceed the budget, drop the lowest-scoring match rather than truncating summaries. Log a debug message when matches are dropped so token pressure can be monitored.

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

**npm packages (already installed, no action needed):**
- `pdf-parse` (^2.4.5) — PDF text extraction
- `mammoth` (^1.12.0) — DOCX text extraction

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
| `scripts/seed-sage-context.mjs` | Create | Initial bootstrap script |
| `config/sage-overrides.json` | Create | Optional override/exclusion config (version-controlled) |
| `src/lib/sage/knowledge-base.ts` | Modify | Enhanced getDocumentContext() with links, token budget, SageDocument interface |
| `src/lib/sage/personality.ts` | Modify | Add document linking instruction to Sage |
| `src/app/api/chat/send/route.ts` | Modify | Add daily rate limit, role-based hourly limits, pass maxResults |
| `src/lib/rate-limit.ts` | Modify | Add calendar-day-based window support for daily limits |
| `prisma/schema.prisma` | Modify | Add fileModifiedAt to ProgramDocument |
| `package.json` | Modify | Add `seed:sage-context` script |
