# Catalog Batch-1 Activation Preview (read-only, operator approval pending)

**Status:** DRAFT — no catalog/allowlist/DB state was changed to produce this
document. This is the decision artifact for the operator to review before
running the batch-activation loop in
[`docs/runbooks/catalog-operations.md`](../runbooks/catalog-operations.md).

**Generated:** 2026-07-03, against the remote (Supabase) `DATABASE_URL` in
`.env.local`, read-only queries only (`findMany`/`count`/`groupBy` — no
writes).

## 1. Orphan corpus profile

463 of 513 `ProgramDocument` rows have `usedBySage=false` (matches the
runbook's stated baseline). Profile of the 463 orphans:

### By category

| Category | Orphaned count |
|---|---|
| TEACHER_GUIDE | 348 |
| CERTIFICATION_INFO | 66 |
| LMS_PLATFORM_GUIDE | 23 |
| PRESENTATION | 10 |
| STUDENT_RESOURCE | 12 |
| ORIENTATION | 3 |
| DOHS_FORM | 1 |

### By audience

| Audience | Orphaned count |
|---|---|
| TEACHER | 348 |
| BOTH | 113 |
| STUDENT | 2 |

### By category + audience

```
CERTIFICATION_INFO:BOTH    66
DOHS_FORM:BOTH               1
LMS_PLATFORM_GUIDE:BOTH    23
ORIENTATION:BOTH             1
ORIENTATION:STUDENT          2
PRESENTATION:BOTH           10
STUDENT_RESOURCE:BOTH       12
TEACHER_GUIDE:TEACHER      348
```

### By mimeType (orphans only)

`application/pdf`: 372, `image/jpeg`: 42, `image/png`: 35,
`application/vnd.openxmlformats-officedocument.presentationml.presentation`
(pptx): 11, `application/octet-stream` (audio/video — an .mp3 and an .avi):
3.

### Schema note on "extractable text"

`ProgramDocument` has no `textExtracted` boolean field — checked
`prisma/schema.prisma` directly. The closest proxy is `mimeType` plus
whether `sageContextNote` is already populated (all synced/curated docs get
a note written by `catalog:generate`/`catalog:sync`, but **orphans can also
already carry a `sageContextNote`** left over from an earlier
`seed-sage-context`/`seed-documents` pass — 462 of the 463 active orphans do
have a non-empty note, length 51–636 chars). PDFs are the only format the
current `catalog:sync` pipeline extracts text from (`pdf-parse`); images
(jpeg/png — mostly certificate/exam-completion graphics) and the two
audio/video files are not text-extractable and were excluded from
candidates on that basis regardless of category/audience match.

### Student-facing, active, priority-category orphans

Filtering to `audience IN (STUDENT, BOTH)`, `isActive=true`, and the 8
"safe student categories" from `scripts/lib/sage-rag-utils.mjs`
(`ORIENTATION, STUDENT_RESOURCE, STUDENT_REFERRAL, DOHS_FORM,
CERTIFICATION_INFO, LMS_PLATFORM_GUIDE, READY_TO_WORK, PROGRAM_POLICY`)
narrows 463 orphans to **104 candidates**:

| Category | Count |
|---|---|
| CERTIFICATION_INFO | 66 |
| LMS_PLATFORM_GUIDE | 23 |
| STUDENT_RESOURCE | 12 |
| ORIENTATION | 3 |

`DOHS_FORM`, `STUDENT_REFERRAL`, `READY_TO_WORK`, and `PROGRAM_POLICY` have
0 student-facing orphans left — those categories are already well-covered
by the existing 22 approved nodes.

Of the 104, most of `CERTIFICATION_INFO` is exam artifacts for one
certification track (Bring Your A Game to Work: quizzes, paper exams,
answer keys, an .mp3 rap, an .avi video, PPTs) and per-student certificate
graphics (IC3 GS6 level 1–3, Edgenuity, Burlington English, CSMLearn) —
low value for Sage RAG (nothing a student would ask Sage to explain) and/or
not text-extractable. These were excluded from batch 1 by design, not
oversight.

## 2. Batch-1 candidates (12)

Selected for: student-facing audience, categories students actually ask
about per `config/sage-rag-eval.json` and `catalog/log.md` (orientation
paperwork, portfolio/employment prep, referral/screening forms, platform
certification study material), and a non-trivial existing
`sageContextNote` (less curation work in step (c) of the runbook).

| # | Title | storageKey | Category / Audience | Why it earns a slot | Draft "when to use" |
|---|---|---|---|---|---|
| 1 | CTE Learning Needs Styles instrument | `orientation/CTE Learning Needs Styles instrument.pdf` | ORIENTATION / STUDENT | Orientation-phase screening tool; matches the fixture theme "what papers do I sign at intake" (`low-literacy-orientation-forms`). | When a student is being screened for learning-style/accommodation needs during intake, before or alongside the standard orientation checklist. |
| 2 | New Student Welcome Letter | `forms/New Student Welcome Letter.pdf` | STUDENT_RESOURCE / BOTH | Longest existing note (636 chars) — already well-curated; first-touch document new students ask about. | When a new student asks what to expect on day one or wants the official welcome/intro to the SPOKES program. |
| 3 | PY 24 Student Profile Fillable 11.15.23 | `forms/PY_24_Student_Profile_Fillable_11.15.23.pdf` | STUDENT_RESOURCE / BOTH | Same family as the already-catalogued `student-profile` form (FY26); students ask which profile form to fill out — a close-confusion case like the FY25/FY26 pairs already in `sage-rag-eval.json`. | When a student needs the prior-year (PY24) student profile intake form specifically — distinguish from the current FY26 fillable version. |
| 4 | Referral for Identifying Disabilities v1 | `forms/Referral_for_Identifying_Disabilities_v1.pdf` | STUDENT_RESOURCE / BOTH | Direct match to the accommodation/disability-referral topic area; students/coordinators ask about this by name. | When a student or teacher needs the referral form used to flag a possible disability for accommodation review. |
| 5 | WVAdultEd ESOL RegistrationBackground Interview (fillable, July 2022) | `forms/WVAdultEd_ESOL_RegistrationBackground_Interview-fillable_updated_July_2022.pdf` | STUDENT_RESOURCE / BOTH | ESOL-track intake form — fills a real gap (no ESOL-specific document is currently in the catalog). | When an ESOL (English-language-learner) student is completing program registration and background interview paperwork. |
| 6 | SPOKES Life and Employability Module Rubric Record | `forms/SPOKES Life and Employability Module Rubric Record.pdf` | STUDENT_RESOURCE / BOTH | Already referenced as an `expectedStorageKey`/`acceptableStorageKeys` target in the `low-literacy-portfolio` fixture in `config/sage-rag-eval.json` — activating it closes a fixture gap, not just adds a doc. | When a student asks what goes in their portfolio/work folder for the Life and Employability module, or how that module is scored. |
| 7 | Employment Portfolio Checklist FY26 Fillable | `forms/Employment_Portfolio_Checklist_FY26_Fillable.pdf` | CERTIFICATION_INFO / BOTH | Also an `expectedStorageKey` target in the same `low-literacy-portfolio` fixture — pairs with #6 for the portfolio-checklist question family. | When a student wants the checklist of what documents/items belong in their employment portfolio before program completion. |
| 8 | Request for Records v1 | `forms/Request_for_Records_v1.pdf` | STUDENT_RESOURCE / BOTH | Common student ask (transcripts/records request) not currently covered by any approved node. | When a student needs to formally request their program records or transcript be released or transferred. |
| 9 | Learning Needs Screening | `forms/Learning Needs Screening.pdf` | STUDENT_RESOURCE / BOTH | Pairs with #1 and #4 (screening → referral pipeline); picks the `forms/` copy as canonical — **note:** an apparent duplicate of the same title also exists at `lms/certifications/program-info/Learning Needs Screening.pdf` with an empty `sageContextNote`; only the `forms/` copy (populated note) is proposed for batch 1, to avoid activating two ProgramDocument rows with the same content. | When a student needs the initial learning-needs screening form used before a disability referral is considered. |
| 10 | LNS with Referral 4.24 | `forms/LNS_with_Referral_4.24.pdf` | STUDENT_RESOURCE / BOTH | Combined screening+referral version (newer, dated 4/24) — companion to #9; both are small/cheap to activate together and the harness fixture can disambiguate them like the existing WVW-70/WVW-25 pair. | When a student or teacher needs the combined Learning Needs Screening-with-Referral form (the newer 2024 combined version) rather than the screening-only form. |
| 11 | WVAdultEd Sample Non-Discrimination Notice | `forms/WVAdultEd Sample Non-Discrimination Notice.pdf` | STUDENT_RESOURCE / BOTH | Policy-adjacent student right; already have `non-discrimination` as an approved form key in the allowlist for the general form — this is the ProgramDocument-catalogued sample notice version, useful if students ask "what's the non-discrimination policy." | When a student asks about the program's non-discrimination policy or wants to see the official notice language. |
| 12 | IC3 GS6 Level 1 Teacher Workbook | `lms/GMetrix and LearnKey/IC3/IC3_GS6_Level_1_Teacher_Workbook.pdf` | CERTIFICATION_INFO / BOTH | Only genuinely study-content (not just a certificate graphic) IC3 item among the CERTIFICATION_INFO orphans; matches the real certification-prep question pattern seen in `sage-form-eval.json`/`sage-rag-eval.json` for other certs (Aztec, IC3). Title says "Teacher" but `audience=BOTH` in the DB — verify this is genuinely student-usable study material (not an answer key) before approving; flag for operator review rather than auto-approve. | When a student preparing for the IC3 GS6 Level 1 certification exam wants the study workbook (verify audience/answer-key status before flipping to approved). |

**Explicitly excluded from batch 1 (seen but not selected), with reason:**

- `orientation/SPOKES_Rights_and_Responsibilites_FY26_Fillable.pdf` —
  **typo'd near-duplicate** of the already-approved allowlist key
  `orientation/SPOKES_Rights_and_Responsibilities_FY26_Fillable.pdf`
  ("Responsibilites" vs "Responsibilities", missing an "i"). Same document,
  different storageKey/row. Do not activate — would create a duplicate
  retrieval hit for the same question the approved node already answers.
  Recommend a separate cleanup (mark inactive or verify it's a stray
  upload) rather than folding into batch 1.
- `forms/Rights_and_Responsibilities_FY25.pdf` — prior-year version of the
  same already-approved document; stale, not selected.
- `forms/Prospective_Employer_Letter_ESP_EIP.docx.pdf`,
  `forms/CTE Learning Needs Styles instrument.pdf` (duplicate of #1, filed
  under `forms/` instead of `orientation/`) — duplicate-content candidates,
  held back from batch 1 to keep the batch to distinct documents; can be a
  follow-on batch once #1 is validated.
- All `CERTIFICATION_INFO` Bring-Your-A-Game-to-Work quizzes/exams/answer
  keys, per-student certificate images (IC3/Edgenuity/Burlington/CSMLearn),
  and the `.mp3`/`.avi` files — not text-extractable (images/audio/video)
  or low RAG value (answer keys, generic certificate graphics). See
  Section 1.

## 3. Execution commands (after operator approval)

Run from repo root, in order, per
[`docs/runbooks/catalog-operations.md`](../runbooks/catalog-operations.md):

```bash
# a. Confirm candidates once more against live DB state right before executing
npm run sage:rag:audit -- --categories=ORIENTATION,STUDENT_RESOURCE,CERTIFICATION_INFO --audiences=STUDENT,BOTH

# b. Add the approved storageKeys to config/catalog-allowlist.json under "documents",
#    e.g.:
#    "documents": [
#      "lms/Aztec/Aztec_PLUS_Student_Support_Guide__-_Version_9.0_1.pdf",
#      "lms/Aztec/Internet_Student_Handout_-_PLUS_Version_9.0_1.pdf",
#      "orientation/SPOKES Checklist for Student Orientation.pdf",
#      "orientation/CTE Learning Needs Styles instrument.pdf",
#      "forms/New Student Welcome Letter.pdf",
#      "forms/PY_24_Student_Profile_Fillable_11.15.23.pdf",
#      "forms/Referral_for_Identifying_Disabilities_v1.pdf",
#      "forms/WVAdultEd_ESOL_RegistrationBackground_Interview-fillable_updated_July_2022.pdf",
#      "forms/SPOKES Life and Employability Module Rubric Record.pdf",
#      "forms/Employment_Portfolio_Checklist_FY26_Fillable.pdf",
#      "forms/Request_for_Records_v1.pdf",
#      "forms/Learning Needs Screening.pdf",
#      "forms/LNS_with_Referral_4.24.pdf",
#      "forms/WVAdultEd Sample Non-Discrimination Notice.pdf",
#      "lms/GMetrix and LearnKey/IC3/IC3_GS6_Level_1_Teacher_Workbook.pdf"
#    ]
#    (final list is the operator's call — this preview proposes 12; the
#    operator may drop #12 pending the answer-key check noted above)
npm run catalog:generate

# c. Hand-curate each new catalog/documents/<slug>.md — fill in
#    "## When to use" / "## When NOT to use" / "## Related" using the draft
#    one-liners above as a starting point, then flip vq_status: draft -> approved

# d. Validate (filesystem-only check; run with a real DATABASE_URL for full parity)
npm run catalog:validate

# e. Sync — dry run first, then apply
npm run catalog:sync
npm run catalog:sync -- --apply

# f. Backfill embeddings for the newly-synced docs
npm run sage:rag:backfill

# g. Drift check — confirms sageContextNote in DB matches the approved node
npm run catalog:drift

# h. Add one fixture per newly-activated doc to config/sage-rag-eval.json,
#    then run the regression gate
npm run sage:rag:harness -- --strict-clean

# i. Commit config/catalog-allowlist.json + catalog/documents/*.md + the new
#    fixtures together, after a paths-only secret scan of the diff
```

Rollback path if a document turns out wrong post-activation:
`PATCH /api/teacher/documents/sage-context` with
`{ "documentId": "<id>", "usedBySage": false }` (see runbook "Rollback"
section) — no DB hand-edits.

## 4. Usage-data status (`npm run sage:usage:summary`)

Ran read-only against the remote DB, default 7-day window
(2026-06-25T21:01Z → 2026-07-02T21:01Z):

```
VisionQuest Sage Usage Summary
Total calls: 779
Total tokens: 49919 (input 49919 / output 0)

By call site:
  sage_form_search_index — 20 calls (2.6%), models: gemini-embedding-001
  sage_embedding_ingest — 17 calls (2.2%), models: gemini-embedding-001
  sage_embedding_query — 547 calls (70.2%), models: gemini-embedding-001
  sage_form_search_query — 192 calls (24.6%), models: gemini-embedding-001
  sage_memory_extract — 2 calls (0.3%), models: gemini-embedding-001
  phase5-smoke — 1 calls (0.1%), models: gemini-embedding-001
```

**Honest read:** as expected, there is no `sage_chat` or `sage_post.*`
callSite data at all in the remote DB. All 779 logged calls are
embedding-related (`sage_embedding_*`, `sage_form_search_*`) or a one-off
`sage:memory:eval`/Phase-5 smoke row — pre-existing RAG/form-search
activity, not chat-token accounting. This matches expectations: the
`withUsageLogging()` wiring that writes `sage_chat` and `sage_post.goals` /
`sage_post.discovery` / `sage_post.mood` / `sage_post.classroom` rows on
every chat turn lives on `feat/sage-token-eval` (PR #100,
`mergedAt: null` — confirmed via `gh pr view 100`) and this worktree branch
stacked on top of it. **Neither is deployed to production** (the app
backing this remote `DATABASE_URL`), so no chat traffic has gone through
that logging path yet. Output tokens are 0 across the board because
embedding calls have no output-token dimension — this is expected, not a
bug.

**What will populate it:** once PR #100 (or this branch, once it lands)
deploys to the environment backing this `DATABASE_URL`, every Sage chat
turn will log one `sage_chat` row plus one row per post-response extractor
(`sage_post.goals`, `sage_post.discovery`, `sage_post.mood`,
`sage_post.classroom`) via `withUsageLogging()` in
`src/lib/chat/post-response.ts` and `src/app/api/chat/send/route.ts:623`.
At that point `sage:usage:summary` will show real chat-token volume and
this batch-1 preview's "students actually ask about" prioritization can be
re-validated against real call-site data instead of only the static
`sage-rag-eval.json`/`sage-form-eval.json` fixtures and `catalog/log.md`
notes used here.

## 5. Sentinel / PII check

Every title above and in the excluded list was eyeballed for personal
names. One hit: **`BYAG_PPT_by_Kara_Richards.pdf`** (`lms/Bring Your A Game
to Work/BYAG_PPT_by_Kara_Richards.pdf`, CERTIFICATION_INFO/BOTH) contains
what looks like a person's name in the filename/title. It was already
excluded from batch 1 on relevance grounds (a PPTX slide deck by an
external curriculum author, not student-facing Sage-answerable content, not
text-extractable via the current pipeline) — **excluding it doubly on the
name-in-title precaution** per the sentinel check. No other title in the
104-candidate student-facing set or the 12-item batch-1 shortlist contains
what looks like a person's name. All titles reviewed are program/document
names (forms, guides, certificates, module descriptors) — no student PII
appears in this document (titles/categories/storageKeys only, as required).
