# Supabase Pre-Rollout Optimization Plan (v3)

**Created:** 2026-04-01
**Revised:** 2026-04-01 (v2: Codex review #1; v3: Codex review #2)
**Target:** June 2026 (before 11-classroom rollout)
**Branch base:** `feat/api-and-teacher-improvements`

## Overview

Optimize VisionQuest to fully leverage Supabase Pro ($25/mo) capabilities before scaling from 1 to 11 classrooms. Four phases plus a prerequisite fix.

**Revised order (per Codex):** 0 -> 1 -> 2 -> 3 -> 4

## Codex Review Findings Addressed

### Review #1 (v1 -> v2)

| # | Finding | Severity | Resolution |
|---|---------|----------|------------|
| 1 | RLS needs class-scoped teacher access, not global bypass | HIGH | Phase 3 uses 3 GUC variables; teacher policies JOIN through SpokesClassInstructor |
| 2 | ENABLE_RLS kill switch doesn't actually work | HIGH | Dual connection pools: vq_app (RLS) + postgres (bypass); rollback = swap DATABASE_URL |
| 3 | Job processor has TOCTOU race condition | HIGH | New Phase 0 fixes atomic job claiming before migrating scheduler |
| 4 | Storage phase mislabeled; use S3 presigned URLs, not @supabase/supabase-js | MEDIUM | Phase 2 uses @aws-sdk/s3-request-presigner; scoped to downloads only |
| 5 | Ordering: RLS (isolation) should ship before RAG (additive) | MEDIUM | Reordered: 0 -> 1 -> 2 (storage) -> 3 (RLS) -> 4 (RAG) |

### Review #2 (v2 -> v3)

| # | Finding | Severity | Resolution |
|---|---------|----------|------------|
| 6 | Server components call getSession() + Prisma outside withAuth — GUCs won't reach them | HIGH | Phase 3 adds AsyncLocalStorage middleware in Next.js middleware.ts; server components use session-aware Prisma client via shared context |
| 7 | ProgramDocument classified as "read-all" but app filters by audience/isActive | HIGH | Phase 3 RLS policy preserves audience + isActive constraints |
| 8 | Table coverage incomplete — missing CertRequirement, AdvisorAvailability, Opportunity, CareerEvent, PasswordResetToken, SecurityQuestionAnswer; SPOKES tables need JOINs | HIGH | Phase 3 includes complete policy matrix for ALL schema tables |
| 9 | Atomic claim returns attempts+1 but failure handler assumes pre-claim value | MEDIUM | Phase 0 handler accounts for already-incremented attempts (max check uses < 3 in SQL, handler uses returned value) |
| 10 | vq_app role password in checked-in migration leaks credentials | MEDIUM | Phase 3 separates role creation (migration, no password) from credential provisioning (Supabase dashboard) |

---

## Phase 0: Fix Job Processor Race Condition (0.5 days, MEDIUM risk)

**Prerequisite for Phase 1.** The job processor at `src/lib/jobs.ts:88-104` has a TOCTOU race: `findMany` reads pending jobs, then a separate `update` claims them. Overlapping invocations can double-process.

### Steps

1. **Replace two-step claim with atomic `UPDATE ... RETURNING`** (File: `src/lib/jobs.ts`)
   - Replace the current `findMany` + per-job `update` pattern (lines 88-104) with a single raw SQL transaction:
     ```sql
     UPDATE visionquest."BackgroundJob"
     SET status = 'processing', "startedAt" = now(), attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM visionquest."BackgroundJob"
       WHERE status = 'pending' AND attempts < 3
       ORDER BY "createdAt" ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *
     ```
   - `FOR UPDATE SKIP LOCKED` ensures concurrent callers never claim the same row — they skip already-locked rows instead of waiting.
   - This is a single atomic operation: no window between read and claim.

2. **Update `processJobs()` to use claimed results** (File: `src/lib/jobs.ts`)
   - The `$queryRaw` returns the claimed jobs directly with `attempts` already incremented. Loop over them and execute handlers as before.
   - Remove the old `findMany` + individual `update` calls.
   - **Important (Codex #9)**: The returned `attempts` value is post-increment. The failure handler at line 127-132 currently checks `job.attempts` assuming pre-increment. Since the SQL `WHERE attempts < 3` already gates retry eligibility, the handler should use the returned value as-is and NOT re-increment. The max-attempts check belongs in the SQL claim query, not in the handler.

3. **Verify with concurrent test** (File: `src/lib/jobs.test.ts`)
   - Insert 5 pending jobs, call `processJobs(5)` twice concurrently, assert each job is processed exactly once.

### Why This Must Be Phase 0
- pg_cron (Phase 1) migrates the job-processor schedule to Supabase. If the race exists when we migrate, pg_cron's more reliable scheduling makes overlap MORE likely (Render cron's cold starts accidentally provided some jitter).

### Branch: `feat/atomic-job-claim`

---

## Phase 1: pg_cron Migration (1-2 days, LOW risk)

Move 3 Render cron jobs into Supabase pg_cron via `pg_net` HTTP calls.

### Steps
1. **Enable `pg_cron` and `pg_net` extensions** (Supabase Dashboard > Database > Extensions)

2. **Store CRON_SECRET in Supabase Vault** (Supabase Dashboard > Database > Vault)
   - Insert secret: `SELECT vault.create_secret('CRON_SECRET', '<value>');`
   - Reference in cron SQL via `vault.decrypted_secrets` view
   - Avoids plaintext secrets in migration SQL

3. **Store APP_BASE_URL as PostgreSQL GUC** (Supabase Dashboard > Database > Configuration)
   - Set custom GUC: `ALTER DATABASE postgres SET app.base_url = 'https://visionquest.onrender.com';`
   - Reference in cron SQL via `current_setting('app.base_url')`

4. **Create pg_cron SQL migration** (File: `prisma/migrations/YYYYMMDD_add_pg_cron_jobs/migration.sql`)
   - 3 jobs using `cron.schedule()` + `net.http_post()` / `net.http_get()`:
     - `appointment-reminders`: `0 * * * *` -> POST `{base_url}/api/internal/appointments/reminders`
     - `job-processor`: `*/10 * * * *` -> POST `{base_url}/api/internal/jobs/process`
     - `daily-coaching`: `0 13 * * *` -> GET `{base_url}/api/internal/coaching/daily`
   - Each includes `Authorization: Bearer {cron_secret}` header from Vault

5. **Add monitoring cron** (same migration)
   - 4th cron job running hourly: queries `cron.job_run_details` for failures in last hour
   - On failure: calls `net.http_post()` to `/api/internal/cron-health` which logs to Sentry

6. **Test all 4 jobs manually** via `SELECT cron.schedule(...)` one-shot triggers
   - Verify each API route responds, check Sentry logs and database state

7. **Remove Render cron services** (File: `render.yaml`)
   - Delete 3 `type: cron` blocks
   - Keep scripts in `scripts/` with deprecation comments as fallback docs

### Branch: `feat/pg-cron`

---

## Phase 2: S3 Presigned URLs for Downloads (3-5 days, MEDIUM risk)

Replace server-proxied file downloads with S3 presigned URLs. Uses existing `@aws-sdk/client-s3` — adds only `@aws-sdk/s3-request-presigner` (same SDK family, no new vendor).

### Codex Corrections Applied
- Renamed from "Storage Policies" — presigned URLs are NOT storage policies; they protect the read path via time-limited tokens
- Uses `@aws-sdk/s3-request-presigner` instead of `@supabase/supabase-js` (lower risk, same SDK family)
- Scoped to downloads only; uploads/deletes remain server-side via existing pattern
- Covers archive/bulk downloads (highest bandwidth impact)

### Steps

1. **Install `@aws-sdk/s3-request-presigner`** (File: `package.json`)
   - Compatible with existing `@aws-sdk/client-s3` v3.1008.0

2. **Add `getPresignedDownloadUrl()` to storage module** (File: `src/lib/storage.ts`)
   - Function: `getPresignedDownloadUrl(storageKey: string, expiresIn?: number): Promise<string>`
   - Default expiry: 3600 seconds (1 hour)
   - Uses `GetObjectCommand` + `getSignedUrl()` from presigner
   - Returns `null` if `HAS_STORAGE_CONFIG` is false (local dev fallback)

3. **Configure storage bucket as Private** (Supabase Dashboard > Storage)
   - Bucket: Private (not public)
   - Max file size: 10MB
   - Allowed MIME types: `application/pdf`, `image/jpeg`, `image/png`, `image/gif`

4. **Update download routes** (Feature flag: `USE_PRESIGNED_URLS=true`)
   - `GET /api/files/download` — validate ownership, return 302 redirect to presigned URL
   - `GET /api/documents/download` — validate auth, return 302 redirect
   - `GET /api/forms/download` — validate auth, return 302 redirect (handle `mode=view` via Content-Disposition param in presigned URL)
   - `GET /api/teacher/students/[id]/archive` — return presigned URL for ZIP (highest impact: 50-100MB files bypass Node.js memory)
   - Keep `downloadFile()` buffer path as fallback when `USE_PRESIGNED_URLS=false` or local dev

5. **Update frontend for redirect-based downloads** (Files: file display components)
   - 302 redirects work transparently for `<a href>` and `window.open()` — minimal frontend changes
   - For `<img src>` cases: fetch presigned URL from API, set as `src`

6. **Test all download paths** — student files, program docs, forms (view + download mode), teacher archives

### Branch: `feat/presigned-urls`

---

## Phase 3: Row Level Security (10-15 days, HIGH risk)

Add database-level access control as defense-in-depth for multi-classroom deployment. This is the core security upgrade for the 11-classroom rollout.

### Codex Corrections Applied
- Teacher access is CLASS-SCOPED (via `SpokesClassInstructor`), not a global staff bypass
- Kill switch = dual connection pools + role swap, not an env var toggle
- Session context requires 3 GUC variables, not just 1
- Rollback is tested and documented
- **(v3)** Session context must propagate to BOTH API routes (withAuth) AND server components (getSession + Prisma)
- **(v3)** ProgramDocument RLS preserves `audience` and `isActive` filters, not blanket read-all
- **(v3)** Complete policy matrix covers ALL schema tables including CertRequirement, AdvisorAvailability, Opportunity, CareerEvent, PasswordResetToken, SecurityQuestionAnswer
- **(v3)** Role creation in migration uses `NOLOGIN`; credentials provisioned via Supabase dashboard, not in SQL

### Phase 0 Prerequisite: DB Session Context Design

Before writing policies, establish how Prisma passes identity to PostgreSQL.

**Session GUC variables:**
- `app.current_user_id` — the authenticated user's Student.id (teachers are Student records)
- `app.current_role` — `student`, `teacher`, or `admin`
- `app.current_student_id` — for student requests: same as user_id; for teacher requests: empty string

**Why 3 variables:** Teacher RLS policies need the teacher's user_id to JOIN against `SpokesClassInstructor.instructorId`. Student RLS policies need the student_id for direct row ownership. The role determines which policy path applies.

**Context propagation (Codex #6 — critical):**

The app has TWO entry points for authenticated DB access:
1. **API routes** — use `withAuth()` / `withTeacherAuth()` wrappers in `src/lib/api-error.ts`
2. **Server components** — call `getSession()` directly then use `prisma` (e.g., `career/page.tsx`, `dashboard/page.tsx`, `goals/page.tsx`)

Both paths must inject GUC variables. Solution: **AsyncLocalStorage-based context** set in Next.js middleware.

```
Next.js middleware.ts
  → getSession() → populate AsyncLocalStorage with {userId, role, studentId}

Prisma client extension (src/lib/db.ts)
  → on every query, reads AsyncLocalStorage
  → wraps query in transaction with SET LOCAL GUCs
  → if no context found (unauthenticated): GUCs are empty strings → RLS fails closed (no rows visible)
```

This covers BOTH server components and API routes because Next.js middleware runs before both. The withAuth wrappers continue to validate auth and return 401; the Prisma extension handles GUC injection transparently.

### Steps

1. **Create `vq_app` role with full schema grants** (File: `prisma/migrations/YYYYMMDD_add_rls_roles/migration.sql`)
   - `CREATE ROLE vq_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;` — **(Codex #10)** Migration creates role WITHOUT password/login. Credentials are provisioned separately via Supabase dashboard (Database > Roles), never checked into git.
   - After migration: enable login + set password via Supabase dashboard, then add `DATABASE_URL` with `vq_app` credentials to Render env vars.
   - `GRANT USAGE ON SCHEMA visionquest TO vq_app;`
   - `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA visionquest TO vq_app;`
   - `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA visionquest TO vq_app;`
   - `ALTER DEFAULT PRIVILEGES IN SCHEMA visionquest GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vq_app;`
   - `ALTER DEFAULT PRIVILEGES IN SCHEMA visionquest GRANT USAGE, SELECT ON SEQUENCES TO vq_app;`

2. **Create Prisma client extension for session context** (File: `src/lib/db.ts`)
   - Wrap the Prisma client with `$extends` that injects `SET LOCAL` at query time
   - The extension reads from a request-scoped AsyncLocalStorage context (set by auth middleware)
   - Pattern:
     ```typescript
     // In auth middleware (src/lib/api-error.ts withAuth wrapper):
     sessionContext.run({ userId, role, studentId }, () => handler(session, req));

     // In db.ts Prisma extension:
     // Wraps each query in a transaction that first calls:
     // SET LOCAL "app.current_user_id" = '<id>';
     // SET LOCAL "app.current_role" = '<role>';
     // SET LOCAL "app.current_student_id" = '<id>';
     ```
   - **Critical**: `SET LOCAL` only persists within a transaction. The extension must wrap queries in implicit transactions.
   - For explicit `$transaction` calls, inject `SET LOCAL` at the start of the transaction.

3. **Classify tables into RLS policy groups**

   | Group | Tables | Policy Pattern |
   |-------|--------|----------------|
   | **Student-owned** | Conversation, Message (after studentId denorm), Goal, Progression, ProgressionEvent, FileUpload, OrientationProgress, Certification, CertRequirement (via Certification.studentId), PortfolioItem, ResumeData, StudentAlert, Application, EventRegistration, Notification, FormSubmission, VisionBoardItem, GoalResourceLink, CareerDiscovery, MoodEntry, CoachingArc, NotificationPreference, PublicCredentialPage, PasswordResetToken, SecurityQuestionAnswer | `studentId = current_setting('app.current_student_id')` OR teacher-class-scoped OR admin |
   | **Dual-ownership** | Appointment (studentId + advisorId), StudentTask (studentId + createdById), CaseNote (studentId + authorId) | Student sees own rows; teacher sees managed students OR own as advisor/creator/author |
   | **Class-scoped** | SpokesClass, SpokesClassInstructor, StudentClassEnrollment, SpokesRecord (via student enrollment), SpokesChecklistProgress (via student enrollment), SpokesModuleProgress (via student enrollment), SpokesEmploymentFollowUp (via student enrollment) | Teacher sees only their classes via `SpokesClassInstructor` JOIN; admin sees all; SPOKES tables JOIN through `StudentClassEnrollment.studentId` -> `SpokesClassInstructor.classId` |
   | **Teacher-created** | Opportunity, CareerEvent, AdvisorAvailability | Teacher sees own created records + admin sees all; students see active/published only |
   | **System/shared (with filters)** | ProgramDocument **(Codex #7)**: RLS preserves `audience` and `isActive` — students see only `audience IN ('all','student') AND isActive = true`; teachers see all. SageSnippet: same pattern. | Role-aware read with existing business filters |
   | **System/shared (read-all)** | OrientationItem, LmsLink, SpokesChecklistTemplate, SpokesModuleTemplate, CertTemplate | Read: all authenticated; Write: teacher/admin only |
   | **Internal-only** | BackgroundJob, RateLimitEntry, AuditLog, GrantKpiSnapshot, WebhookSubscription, DocumentChunk (Phase 4) | Access via `prismaAdmin` (postgres role) only — no RLS needed |

4. **Denormalize `studentId` onto `Message` table** (File: `prisma/schema.prisma` + migration)
   - Add `studentId String?` column to `Message`
   - Backfill from `Conversation.studentId` via SQL migration
   - Make non-nullable after backfill
   - Avoids slow JOIN-based RLS policy on the highest-volume table

5. **Write student-owned table policies** (File: `prisma/migrations/YYYYMMDD_add_rls_policies/migration.sql`)
   - Pattern per table:
     ```sql
     ALTER TABLE visionquest."Goal" ENABLE ROW LEVEL SECURITY;
     CREATE POLICY student_access ON visionquest."Goal"
       FOR ALL TO vq_app
       USING (
         -- Student sees own rows
         (current_setting('app.current_role', true) = 'student'
           AND "studentId" = current_setting('app.current_student_id', true))
         -- Admin sees all
         OR current_setting('app.current_role', true) = 'admin'
         -- Teacher sees students in their managed classes
         OR (current_setting('app.current_role', true) = 'teacher'
           AND "studentId" IN (
             SELECT sce."studentId"
             FROM visionquest."StudentClassEnrollment" sce
             JOIN visionquest."SpokesClassInstructor" sci
               ON sci."classId" = sce."classId"
             WHERE sci."instructorId" = current_setting('app.current_user_id', true)
               AND sce.status IN ('active', 'inactive', 'completed', 'withdrawn')
           ))
       );
     ```
   - **Optimization**: Create a SQL function `visionquest.managed_student_ids(teacher_id text)` that returns the set of student IDs. Use it in all teacher policies to avoid repeating the JOIN. PostgreSQL will inline/cache it per-transaction.

6. **Write class-scoped and system policies** (same migration)
   - `SpokesClass`: teacher sees classes where they're an instructor; admin sees all
   - System tables: `SELECT` for all, `INSERT/UPDATE/DELETE` for teacher/admin
   - Internal tables: no RLS (accessed only via `vq_admin` connection)

7. **Write dual-ownership policies** (same migration)
   - `Appointment`: student sees own (`studentId`); teacher sees managed students OR own as advisor (`advisorId`)
   - `StudentTask`: student sees own; teacher sees managed students OR own as creator
   - `CaseNote`: student sees own; teacher sees managed students OR own as author

8. **Set up dual connection pools** (Environment variables)
   - `DATABASE_URL` = `vq_app` role credentials (RLS enforced) — used by Prisma for all app queries
   - `DIRECT_URL` = `postgres` role (BYPASSRLS) — used for migrations only
   - `ADMIN_DATABASE_URL` = `postgres` role — new env var for cron jobs, background jobs, admin operations that need to bypass RLS
   - Create a second Prisma client instance (`prismaAdmin`) in `src/lib/db.ts` that uses `ADMIN_DATABASE_URL`
   - Background job processor, cron endpoints, and admin-only routes use `prismaAdmin`

9. **Rollback procedure** (documented, tested before deploy)
   - **Instant rollback**: Change `DATABASE_URL` on Render to point back to `postgres` role credentials → redeploy. RLS policies still exist on tables but `postgres` bypasses them. Zero code change needed.
   - **Full rollback**: Run migration to `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` on all tables.
   - Test both paths in staging before production deploy.

10. **Integration testing** (File: `src/lib/rls.test.ts`)
    - Connect as `vq_app` with Student A context → verify can see own data, cannot see Student B's
    - Connect as `vq_app` with Teacher context → verify can see students in managed classes only, not other classes
    - Connect as `vq_app` with Admin context → verify can see all students
    - Connect as `vq_app` with no context → verify gets empty results (fail-closed)
    - Verify `prismaAdmin` bypasses all RLS

11. **Deploy during low-traffic window** (weekend or evening)
    - Monitor Sentry for 403/500 errors for 24 hours
    - Keep rollback procedure ready

### Branch: `feat/rls`

---

## Phase 4: pgvector + RAG Pipeline (5-8 days, MEDIUM risk)

Ground Sage in actual SPOKES program documents via vector similarity search.

### Steps

1. **Enable `vector` extension** (Supabase Dashboard > Database > Extensions)

2. **Create `DocumentChunk` table** (File: `prisma/schema.prisma` + raw SQL migration)
   - Prisma model for non-vector columns (id, documentId, chunkIndex, content, tokenCount, createdAt)
   - Use `Unsupported("vector(768)")` in Prisma schema for the embedding column (metadata-only; actual reads/writes via `$queryRaw`)
   - Raw SQL migration adds the column and IVFFlat index:
     ```sql
     ALTER TABLE visionquest."DocumentChunk" ADD COLUMN embedding vector(768);
     CREATE INDEX idx_doc_chunk_embedding ON visionquest."DocumentChunk"
       USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
     ```

3. **Create embedding utility** (New file: `src/lib/rag/embeddings.ts`)
   - `generateEmbedding(text: string): Promise<number[]>` using Gemini `text-embedding-004`
   - `generateEmbeddings(texts: string[]): Promise<number[][]>` with batching + exponential backoff
   - Rate limit: 100 chunks/minute for bulk ingestion
   - Uses program-level `GEMINI_API_KEY` (not student keys)

4. **Build ingestion pipeline** (New file: `src/lib/rag/ingest.ts`)
   - Read PDF from `ProgramDocument` records where `usedBySage = true`
   - Download from Supabase Storage via existing `downloadFile()`
   - Extract text via `pdf-parse`
   - Chunk: ~500 tokens per segment, 50-token overlap
   - Generate embeddings via utility
   - Upsert: delete old chunks for document, insert new ones
   - Add `quality` flag to skip chunks with low text quality (< 50 chars after whitespace trim)

5. **Create vector search** (New file: `src/lib/rag/search.ts`)
   - `searchDocuments(query: string, topK?: number): Promise<DocumentChunk[]>`
   - Generate query embedding, run cosine similarity via `$queryRaw`:
     ```sql
     SELECT *, 1 - (embedding <=> $1::vector) AS similarity
     FROM visionquest."DocumentChunk"
     WHERE 1 - (embedding <=> $1::vector) > 0.7
     ORDER BY embedding <=> $1::vector
     LIMIT $2
     ```
   - Timeout: 2 seconds; fallback to keyword-only if slow

6. **Integrate into chat flow** (Files: `src/lib/sage/knowledge-base.ts`, `src/app/api/chat/send/route.ts`)
   - Modify `getDocumentContext()`: call `searchDocuments(userMessage)` + existing keyword matching
   - Merge and deduplicate results, take top 5 chunks
   - Format as context appended to system prompt between `[DOCUMENT_CONTEXT_START]` / `[DOCUMENT_CONTEXT_END]` delimiters
   - Instruct Sage in system prompt to treat as reference material only (prompt injection mitigation)

7. **Create ingestion API route** (New file: `src/app/api/internal/rag/ingest/route.ts`)
   - CRON_SECRET-protected
   - Full re-ingestion of all `usedBySage = true` documents
   - Single-document ingestion by ID
   - Add weekly pg_cron job for full re-ingestion

8. **Add document upload hook** (File: `src/app/api/documents/route.ts`)
   - On teacher upload/update with `usedBySage = true`: enqueue `rag_ingest` BackgroundJob

9. **Seed initial embeddings** (New file: `scripts/seed-embeddings.mjs`)
   - Upload SPOKES program documents to ProgramDocument records
   - Call ingestion API

10. **Quality evaluation**
    - Manual test: ask Sage 10 SPOKES-specific questions, compare with/without RAG
    - Measure P50 chat latency impact (target: < 200ms increase)

### Branch: `feat/rag-pipeline`

---

## Timeline

| Phase | Effort | Calendar | Status |
|-------|--------|----------|--------|
| Phase 0: Atomic job claiming | 0.5 days | Week 1 | Not started |
| Phase 1: pg_cron | 1-2 days | Week 1 | Not started |
| Phase 2: S3 presigned URLs | 3-5 days | Week 2 | Not started |
| Phase 3: RLS | 10-15 days | Week 3-6 | Not started |
| Phase 4: RAG/pgvector | 5-8 days | Week 5-7 (parallel with RLS testing) | Not started |
| Buffer + integration testing | 3-5 days | Week 7-8 | -- |

**Total: ~7-8 weeks.** Phases 3 and 4 can overlap (RAG development while RLS is in soak testing).

## Success Criteria

- [ ] Job processor uses atomic `FOR UPDATE SKIP LOCKED` claiming; concurrent test passes
- [ ] All 3 Render cron services removed; pg_cron running 7+ days with monitoring
- [ ] File downloads use S3 presigned URLs with 1-hour expiry; archive downloads bypass Node.js
- [ ] RLS enabled on all student-facing tables; Student A cannot see Student B's data via raw SQL as `vq_app`
- [ ] Teacher can only see students in their managed classes (not all students) via RLS
- [ ] Rollback tested: swapping DATABASE_URL to postgres role restores full access
- [ ] Sage answers SPOKES program questions using RAG-retrieved context with source attribution
- [ ] All existing flows pass smoke tests after each phase
- [ ] No P50 chat latency increase beyond 200ms from RAG

## Key Files

| File | Relevance |
|------|-----------|
| `src/lib/jobs.ts:88-104` | TOCTOU race to fix (Phase 0) |
| `src/lib/classroom.ts` | `buildManagedStudentWhere()` — reference for RLS policy logic |
| `src/lib/storage.ts` | Add presigned URL generation (Phase 2) |
| `src/lib/db.ts` | Prisma client — add RLS session extension + admin client (Phase 3) |
| `src/lib/api-error.ts` | `withAuth` wrapper — inject session context for RLS (Phase 3) |
| `src/lib/sage/knowledge-base.ts` | RAG integration point (Phase 4) |
| `prisma/schema.prisma` | All models in `visionquest` schema |
| `render.yaml` | Remove 3 cron services (Phase 1) |
