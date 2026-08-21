# Runbook: Sage Career-Grounding Sync (Phase B → live)

**Goal:** Land the 15 Phase-B career-counseling documents (staged in the
`sage-career-grounding` worktree's `docs-upload/`, cataloged under
`catalog/documents/`, allowlisted in `config/catalog-allowlist.json`) into the
Supabase bucket, the `ProgramDocument` RAG index, and Sage's catalog routing
notes — then reconcile the hardcoded knowledge base. Every mutation step below
is **GOVERNED — BRITT EXECUTES**. Nothing in this runbook runs automatically.

Phase A contract: `.planning/career-grounding/phase-a-inventory.md`.
Phase B staging record: `.planning/career-grounding/phase-b-staging-manifest.md`
(sha256 per file, slug deviations, decisions).

## 1. Preconditions — Britt's Q1–Q8 decision state

**Resolved 2026-07-23** in `.planning/career-grounding/phase-a-inventory.md` §6 / §6a. Adopt these before upload; reverse only if Britt changes course.

| Q | Decision | Phase B / later action |
|---|----------|------------------------|
| Q1 | Students need `ECP_AE_and_SPOKES_Fillable_FY25`; dual-stage `students/` + `orientation/` | **Not in the original 15** — add ECP student + orientation copies as a Phase B+ staging delta before or with sync |
| Q2 | Four piiRisk files cleared; wire interview instruments; **profile fields + per-student `.md`**; occupation guides **gated by COS career-cluster** (e.g. Healthcare guide only if Healthcare cluster) | Promote Pathfinder / Healthcare / Gemini prompts in a follow-on staging batch; Goal Tracker needs PDF (or xlsx ingest); cluster gating waits on Q5 |
| Q3 | WIOA Referral = **instructor profiles only** | Re-stage under **`teachers/`** → bucket `teachers/guides/WIOA Referral Form.pdf`, audience **TEACHER** (supersedes earlier `forms/` staging) |
| Q4 | Purpose-based audience (not blind folder map) | Demand list BOTH; WIOA Fact Sheet **instructor/policy** (move off `students/` → `teachers/`); Cert catalog + Curriculum = Sage ref + presentation; Bridge descriptors **IETP-only**. Per-doc audience may need manual DB set if folder mint disagrees (`sage-overrides.json` cannot override audience today) |
| Q5 | Skip until O*NET / CareerOneStop access | No Phase B work |
| Q6 #11 | Same continuum as image-only RAG PDF — stage DOCX under `students/` | Keep #11; fix OKF "different document" claim (done in catalog node) |
| Q6 #14 | **Three-layer cert offer:** FY catalog SoT now; slim KB post-sync; classroom overlay + assignment in **future sprints** | Stage #14; post-sync KB slim + precedence rule (runbook §6); Phase C Classroom model |
| Q7 | Nicholas County 2021 still valid | Keep; drop "currency unconfirmed" caveat to "still valid FY26/27" |
| Q8 | Refresh Rubric Record with **"-2"** revision | Separate bucket refresh (not in the 15) |

Mechanical preconditions:

1. **Bucket MIME allowlist.** The Supabase `Uploads` bucket enforces an
   allowed-MIME list (it rejected BYAG avi/mp3 on 2026-07-03). PDFs and DOCX
   are proven-in-bucket; **`fy27-updates-final-transcript.md` is the risk** —
   the uploader's `MIME_MAP` has no `.md` entry, so it uploads as
   `application/octet-stream`. Before upload, check Supabase Dashboard →
   Storage → Uploads → allowed MIME types. If markdown/octet-stream is not
   allowed: add `".md": "text/markdown"` to `MIME_MAP` in
   `scripts/upload-to-supabase.mjs` (one-line change, not made in Phase B —
   outside its ownership) AND/OR widen the bucket allowlist.
2. **Secrets present (names only):** `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`
   (S3 upload); `DATABASE_URL`, `GEMINI_API_KEY`, `STORAGE_*`/`R2_*` (sync);
   never print values. **Mac note (2026-07-23):** this checkout's `.env.local`
   has empty `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` / `STORAGE_ENDPOINT` —
   upload cannot run here until those are set.
3. **Worktree / docs-upload intact:** Original Phase B staged 15 files on the
   Windows `sage-career-grounding` worktree. **This Mac checkout does not
   currently hold those binaries** (`docs-upload/students/` lacks the career
   batch). Copy from Windows or re-stage before upload. After Q3/Q4 decisions,
   also move WIOA Referral → `teachers/` and WIOA Fact Sheet → `teachers/`
   before dry-run.
4. **Never live-sync from a partial `docs-upload/` tree** — orphan trap (see §3).

## 2. Upload — GOVERNED, BRITT EXECUTES

Run from the **worktree** (its `docs-upload/` contains exactly the 15 files, so
the upload cannot touch anything else):

```powershell
cd C:\Users\Instructor\Dev\VisionQuest\.claude\worktrees\sage-career-grounding
$env:STORAGE_ACCESS_KEY="<from Supabase S3 access keys>"
$env:STORAGE_SECRET_KEY="<from Supabase S3 access keys>"
node scripts/upload-to-supabase.mjs --dry-run   # must list exactly 15 files
node scripts/upload-to-supabase.mjs             # live upload
```

Expected: `Uploaded: 15, Errors: 0`. If the `.md` file errors, see
precondition 1 — do not proceed to the sync with a missing object (the sync
will refuse that key, by design).

## 3. RAG sync — GOVERNED, BRITT EXECUTES

**WARNING — never run a LIVE sync from the `sage-career-grounding` worktree.**
`syncSageDocuments()` unmarks (`usedBySage=false`) every active Sage document
whose file is absent from the local `docs-upload/` tree. The worktree holds
only 15 files; a live sync from it would orphan the rest of the corpus. The
live sync must run from a checkout whose `docs-upload/` mirrors the full
bucket (the primary checkout), with the 15 staged files copied in first:

```powershell
# copy the staged files into the primary checkout (same relative paths)
robocopy "C:\Users\Instructor\Dev\VisionQuest\.claude\worktrees\sage-career-grounding\docs-upload" `
         "C:\Users\Instructor\Dev\VisionQuest\docs-upload" /E /XC /XN /XO

cd C:\Users\Instructor\Dev\VisionQuest
node scripts/seed-sage-context.mjs --dry-run    # review adds/updates/orphans FIRST
node scripts/seed-sage-context.mjs              # live sync
```

Blast-radius note: the first live sync from the full tree also performs the
**pending 378-row storageKey backfill** (PR #110 follow-up, a separately queued
gate). The dry run will therefore report far more than 15 changes. Either
accept both gates together, or hold this runbook until the backfill gate has
run. Do not try to scope the sync to 15 files by pruning the tree — that is
the orphan trap above.

Alternative (equivalent, rate-limited 1 per 10 min, needs a running app with
the full `docs-upload/` tree): `POST /api/teacher/documents/sage-context/sync`
as a logged-in teacher.

## 4. Catalog sync — GOVERNED, BRITT EXECUTES

After step 3 (rows must exist, else all 15 nodes report "no ProgramDocument —
overlay-only"):

```powershell
cd C:\Users\Instructor\Dev\VisionQuest
npm run catalog:sync                 # dry run: expect 15 new doc-note updates
npm run catalog:sync -- --apply      # write overlay + re-embed curated notes
```

## 5. Verification

1. **Row check (SQL, read-only):**
   ```sql
   SELECT "storageKey", title, category, audience, "usedBySage", "isActive"
   FROM visionquest."ProgramDocument"
   WHERE "storageKey" IN (
     'teachers/guides/WIOA Referral Form.pdf',
     'teachers/guides/New WIOA Fact Sheet 7.11.24.pdf',
     'presentations/fy27-updates-final-transcript.md',
     'students/resources/CFWV Career Exploration Worksheet.pdf',
     'students/resources/Career Discovery Prompts.pdf',
     'students/resources/Career_Pathways_Bridge_Descriptors2020.docx',
     'students/resources/ChatGPT Interview Practice Prompts.pdf',
     'students/resources/Handout_4_SMART_Goal.pdf',
     'students/resources/Handout_5_Career_Planning.pdf',
     'students/resources/Nicholas_County_IET_Food_Service_Management_with_CTE_Career_Pathway.docx',
     'students/resources/Pub_PathwaySccss_Flier_DEVO_AIM.pdf',
     'students/resources/Region 1 Demand Occupation List 2024.pdf',
     'students/resources/SPOKES Life and Employability Skills Curriculum.pdf',
     'students/resources/SPOKES_Certifications.docx',
     'students/resources/STAR_Interview_Worksheet.pdf'
   );
   ```
   Expect **15 rows**, all `usedBySage=true`, `isActive=true`, category
   `STUDENT_RESOURCE`, audience per the Q4 table above. Also confirm the
   `sage.knowledge_sync` audit row reports 0 missing objects among these keys.

2. **Catalog parity:** `npm run catalog:validate` (with `DATABASE_URL`) —
   expect 0 errors; this proves node frontmatter matches the minted rows.
   (Pre-sync, only `npm run catalog:validate -- --no-db` can pass — the
   DB-backed document checks are expected to skip until rows exist.)

3. **RAG retrieval spot-check:** `npm run sage:rag:harness` with a small
   fixture (pattern: `config/sage-rag-top-questions.json`) asking e.g.
   "what jobs are in demand around here" → expect
   `students/resources/Region 1 Demand Occupation List 2024.pdf` in top 3;
   "how can I practice for a job interview" → STAR worksheet or ChatGPT
   prompts; "who pays for job training" → the WIOA fact sheet. Low-text docs
   (WIOA Referral Form, DEVO flier) match on curated notes — check they at
   least appear for exact-title queries.

## 6. Post-sync knowledge-base reconciliation (deferred from Phase B)

Phase B intentionally left `src/lib/sage/knowledge-base.ts` behaviorally
unchanged except one verified factual fix (NCRC exam list: "Business Writing"
→ "Graphic Literacy", per the staged `SPOKES_Certifications.docx`). After
steps 2–5 verify green, reconcile in a normal gated PR (Phase A Q6/#14
three-layer architecture, locked 2026-07-23):

1. ~~`src/lib/spokes/certifications.ts` NCRC correction~~ — already applied on
   this branch (commit `d0345b6`, alongside the knowledge-base.ts fix). No
   post-sync action needed.
2. **Slim `SPOKES_KNOWLEDGE` cert enumeration** to brief + pointer; defer
   detail to the retrievable `spokes-certifications` node (FY catalog =
   source of truth). Add standing precedence: *if another document names a
   cert not in the current catalog, treat it as historical.* Run
   `sage:chat:harness` families before/after.
3. **Phase C (future sprint):** Classroom/site model + instructor elective
   overlay (add/emphasize only; never remove core) + assignment logic
   (`base ∩ classroom`, ranked by student cluster/goals). Not blocking sync.
4. Optionally update the `onboarding` topic prose about the CFWV worksheet
   (it currently says the Sage conversation replaced it; the worksheet is now
   also a retrievable resource).
5. Q4 audience: after folder moves (WIOA Referral + Fact Sheet → `teachers/`),
   verify minted TEACHER rows; Demand List BOTH may still need a manual
   audience set if folder mint is STUDENT-only.

## 7. Rollback

Any regression (bad retrieval, wrong doc surfacing, PII scare):

1. **Deactivate the rows** (teacher UI PATCH
   `/api/teacher/documents/sage-context` per document, or SQL
   `UPDATE visionquest."ProgramDocument" SET "usedBySage"=false WHERE "storageKey" IN (…the 15 keys…);`)
   — curation flags survive future syncs by design.
2. **Remove the 15 keys** from `config/catalog-allowlist.json` `documents` and
   delete the 15 `catalog/documents/*.md` nodes (git revert of the Phase B
   commit), then `npm run catalog:sync -- --apply` to regenerate the overlay.
3. Bucket objects can stay (harmless without rows); removing them is an
   archive-never-delete decision for Britt.
4. The knowledge-base annotation comments are behavior-neutral. The NCRC
   string fixes live in commit `d0345b6` (certifications.ts) and the Phase B
   commit `00c91a4` (knowledge-base.ts) — revert those specifically if ever
   needed; they are factual corrections, so reverting is not expected.
