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

Adopted leans already baked into Phase B (reverse them before upload if you
disagree):

| Q | State | What Phase B did |
|---|-------|------------------|
| Q3 | **Adopted** | WIOA Referral Form staged under `forms/` (bucket key `forms/WIOA Referral Form.pdf`), beside the DFA referral rows — the deviation Phase A flagged. |
| Q6 | **Adopted** | Overlap cross-references authored instead of merging: `career-pathways-bridge-descriptors2020.md` names the corpus "IETP Description of Adult Education Bridge Programs" in When-NOT-to-use; `spokes-certifications.md` names "SPOKES Modules 2025" and the `knowledge-base.ts` cert list. Nothing was double-loaded or blended. |
| Q7 | **Adopted (caveat)** | Nicholas County IET node carries an explicit "2021-dated, currency unconfirmed (Q7)" caveat plus a source-document inconsistency note (Nursing-Assistant line in a Food-Service course description). |

Still **OPEN — decide before or alongside this sync** (none block the upload):

| Q | Open question |
|---|---------------|
| Q1 | ECP audience gap: the only ECP FY25 row is TEACHER_GUIDE/TEACHER — stage a student-audience ECP rendition? (Not part of the 15.) |
| Q2 | piiRisk confirmations for 4 excluded files (`Career_Discovery_Gemini_Prompts.docx`, `Career_Pathfinder_Day_3_Assignment.docx`, `Healthcare_Career_Guide.docx`, `SPOKES_Goal_Tracker.xlsx`). |
| Q5 | Interest-assessment gap: fill via Phase C CareerOneStop APIs (existing `COS_USER_ID` / `COS_API_TOKEN` env pair) or a printable instrument. |
| Q8 | Rubric Record "-2" revision refresh in the bucket. |

Q4 note (audience mechanics): the ingest derives audience from the folder —
`students/` rows mint **STUDENT**, `forms/` and `presentation/` mint **BOTH**.
Phase A proposed BOTH for several `students/` candidates (#3, #4, #9, #11,
#12, #14, #15); the catalog nodes record the folder-derived values so
post-sync parity passes. `config/sage-overrides.json` supports category — not
audience — overrides, so widening audience needs either a code change or a
manual DB update that the next sync can silently revert. Treat as open.

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
   never print values.
3. **Worktree intact:** `docs-upload/` in the `sage-career-grounding` worktree
   holds exactly the 15 staged files (3 folders: `students/` ×13, `forms/` ×1,
   `presentation/` ×1), sha256-verified against sources in the Phase B manifest.

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
     'forms/WIOA Referral Form.pdf',
     'presentations/fy27-updates-final-transcript.md',
     'students/resources/CFWV Career Exploration Worksheet.pdf',
     'students/resources/Career Discovery Prompts.pdf',
     'students/resources/Career_Pathways_Bridge_Descriptors2020.docx',
     'students/resources/ChatGPT Interview Practice Prompts.pdf',
     'students/resources/Handout_4_SMART_Goal.pdf',
     'students/resources/Handout_5_Career_Planning.pdf',
     'students/resources/New WIOA Fact Sheet 7.11.24.pdf',
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
steps 2–5 verify green, reconcile in a normal gated PR:

1. ~~`src/lib/spokes/certifications.ts` NCRC correction~~ — already applied on
   this branch (commit `d0345b6`, alongside the knowledge-base.ts fix). No
   post-sync action needed.
2. Decide whether `SPOKES_KNOWLEDGE`'s 14-item certification list slims down
   to the brief + a pointer, deferring detail to the now-retrievable
   `spokes-certifications` node (token savings vs. always-on accuracy; run
   `sage:chat:harness` families before/after).
3. Decide Q4 audience widening (see precondition table) if Sage's student
   retrieval should NOT see teacher-leaning docs, or teachers should see
   student rows.
4. Optionally update the `onboarding` topic prose about the CFWV worksheet
   (it currently says the Sage conversation replaced it; the worksheet is now
   also a retrievable resource).

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
