# Sage RAG Activation Sprint

**Date:** 2026-05-13
**Status:** Day 2 activation complete; strict top-3 source gate passed
**Goal:** Make Sage use the existing Supabase program-document corpus safely, measurably, and reversibly.

## Sprint Goal

Sage should return relevant document context for the top expected student questions without exposing teacher-only material in student chat.

The blocker is not pgvector. The blocker is activation and curation: the Supabase `ProgramDocument` rows exist, but Sage only reads rows where `usedBySage = true` and `isActive = true`.

## Definition Of Done

- The top-20 student-question harness passes for the current month.
- Top-3 retrieved documents are plausibly relevant for at least 7 of the 10 manual-review questions.
- Student chat sees only `audience = STUDENT` or `audience = BOTH` documents.
- Teacher-only documents remain disabled for student Sage context.
- Activation is manifest-based and reversible.
- Placeholder `sageContextNote` rows are rewritten before being treated as quality-ready.
- Weak or empty `sageContextNote` rows are queued for improvement instead of being blindly enabled.

## Current Sprint Slice

1. Audit note quality across the student-safe corpus. Completed.
2. Curate notes for the top-20 student-question source docs. Completed for 30 docs.
3. Dry-run activation of only good-note documents. Completed.
4. Add rollback manifest support before any live activation. Completed.
5. Run the retrieval harness against the actual `getDocumentContext()` function. Completed.
6. Upgrade harness to measure expected source documents, top-1, top-3, and noisy top-3 docs. Completed.
7. Rewrite and activate the next 20 high-impact docs in category batches. Completed.

## Day 1 Results

- Baseline audit: 154 student-safe candidate docs, 0 active for Sage, 0 good notes.
- Baseline harness: 0/20 top student questions returned document context.
- Curated note update: 30 student-safe docs updated with substantive `sageContextNote` values.
- Activation: 30 curated docs set to `usedBySage = true`.
- Post-activation audit: 154 candidates, 30 already used by Sage, 30 good notes, 106 weak notes, 18 empty notes.
- Post-activation harness: 20/20 top student questions returned document context and matched expected terms.

This verifies that Sage can receive document context. It does not prove answer quality or retrieval ranking quality.
Several post-activation top-3 results include noisy matches, especially where generic terms like "student",
"certification", "form", or "work" dominate the current keyword scoring.

Generated reports:

- `.planning/sage-rag/audit-baseline.json`
- `.planning/sage-rag/harness-baseline.json`
- `.planning/sage-rag/audit-after-notes.json`
- `.planning/sage-rag/audit-after-activation.json`
- `.planning/sage-rag/harness-after-activation.json`

Rollback manifests:

- Notes: `.planning/sage-rag/notes-2026-05-13T13-46-08-392Z.json`
- Activation: `.planning/sage-rag/activation-2026-05-13T13-46-24-975Z.json`

## Day 2 Results

Harness upgrade:

- `config/sage-rag-top-questions.json` now includes `expectedStorageKeys` and `acceptableStorageKeys`.
- `scripts/sage-rag-harness.mjs` resolves retrieved document IDs back to storage keys and reports:
  - legacy context/term pass
  - strict top-3 source pass
  - top-1 expected source
  - top-3 contains expected source
  - clean top-3
  - unexpected top-3 documents

Strict baseline against the initial 30 active docs:

- Legacy context/term pass: 20/20
- Strict top-3 source pass: 20/20
- Top-1 expected: 17/20
- Clean top-3: 1/20
- Unexpected top-3 docs: 28
- Report: `.planning/sage-rag/harness-strict-baseline.json`

After generic keyword filtering, before Day 2 activation:

- Legacy context/term pass: 20/20
- Strict top-3 source pass: 20/20
- Top-1 expected: 19/20
- Clean top-3: 1/20
- Unexpected top-3 docs: 25
- Report: `.planning/sage-rag/harness-after-scoring-before-day2-activation.json`

Day 2 note and activation work:

- Rewrote 20 additional `sageContextNote` values in `config/sage-rag-curated-notes-day2.json`.
- Applied notes from `.planning/sage-rag/notes-2026-05-13T14-59-24-007Z.json`.
- Activated 20 additional docs as category-scoped batches:
  - ORIENTATION: 5 docs, rollback `.planning/sage-rag/activation-2026-05-13T14-59-45-035Z.json`
  - STUDENT_REFERRAL: 4 docs, rollback `.planning/sage-rag/activation-2026-05-13T14-59-51-586Z.json`
  - STUDENT_RESOURCE: 3 docs, rollback `.planning/sage-rag/activation-2026-05-13T14-59-57-903Z.json`
  - LMS_PLATFORM_GUIDE: 3 docs, rollback `.planning/sage-rag/activation-2026-05-13T15-00-05-400Z.json`
  - CERTIFICATION_INFO: 5 docs, rollback `.planning/sage-rag/activation-2026-05-13T15-00-12-134Z.json`

Post-Day 2 audit:

- 154 student-safe candidates
- 50 active for Sage
- 50 good notes
- 87 weak notes
- 17 empty notes
- Report: `.planning/sage-rag/audit-after-day2-activation.json`

Post-Day 2 harness:

- Legacy context/term pass: 20/20
- Strict top-3 source pass: 20/20
- Top-1 expected: 16/20
- Clean top-3: 5/20
- Unexpected top-3 docs: 19
- Report: `.planning/sage-rag/harness-after-day2-activation.json`

Interpretation: Day 2 improved source cleanliness while preserving the strict top-3 gate. The lower top-1 expected
count is partly because newly activated acceptable docs, such as certificate images or benchmark checklists, can
outrank the narrower descriptor document listed as the expected key. Future harness work should distinguish
`top1Expected` from `top1Acceptable`.

## Scoring Reality Check

The existing scoring function already scores title words, `certificationId`, and `platformId`. Most pre-existing
`sageContextNote` values are metadata templates that repeat those same fields, for example:

```text
Title. Related certification: id. Platform: id. Category: CATEGORY.
```

Those notes are non-empty, but they are not substantive summaries. Activating every non-empty note would increase
context volume, but it may also worsen ranking by amplifying metadata rather than student intent.

`SageSnippet` has no rows in the current database (not just inactive — empty). Snippets are out of scope unless
authored separately.

The keyword scorer now filters generic retrieval words such as `certification`, `certificate`, `form`, `student`,
`platform`, and `work` from title/note token matching, while still scoring exact `certificationId` and normalized
`platformId` phrases. This reduced broad metadata-style matches without moving to vector search.

## Note Quality Classifier

The "good / weak / empty" labels in the audit and activation scripts come from
[`scripts/lib/sage-rag-utils.mjs:73-108`](../../scripts/lib/sage-rag-utils.mjs#L73-L108). A note is `good` only if **all**
of the following hold:

- trimmed length ≥ 120 characters
- ≥ 14 unique meaningful words (4+ characters)
- ≥ 8 meaningful words that are **not** present in the document title
- contains operational vocabulary (student, certification, orientation, form, policy, evidence, referral, etc.)
- does **not** match the metadata-only regex (`Title. Related certification: …. Platform: …. Category: ….`)

This is why the baseline reported `0 good notes` even though 132 docs have `sageContextNote` length ≥ 40 — the
templated metadata notes fail the non-title-word and operational-vocabulary tests. Treat any "good note count"
in this plan as the strict-classifier count, not raw non-empty count.

## Remaining Next Slice

1. Keep the current 50 curated docs active while manual answer quality is reviewed.
2. Add a `top1Acceptable` metric so the harness does not treat acceptable certificate proof docs as hard top-1 misses.
3. Review the 19 remaining unexpected top-3 docs and decide whether they are true noise or acceptable adjacent context.
4. Rewrite the next note batch only after that review; do not bulk-activate the remaining metadata-template docs.
5. Audit the 2 `STUDENT_RESOURCE` / `audience = STUDENT` docs with empty notes — every other `STUDENT_RESOURCE` row
   is tagged `BOTH` and has a note. Decide whether the two are audience-misclassified, content-missing, or
   intentionally stranded, then either reclassify, note, or deactivate them.

## Commands

Audit current corpus:

```powershell
npm run sage:rag:audit
```

Write a JSON audit report:

```powershell
npm run sage:rag:audit -- --out=.planning/sage-rag/audit.json
```

Preview activation of good-note, student-visible docs:

```powershell
npm run sage:rag:activate
```

Preview curated note updates:

```powershell
npm run sage:rag:notes
```

Apply curated note updates after reviewing dry-run output:

```powershell
npm run sage:rag:notes -- --apply --confirm=update-sage-rag-notes
```

Roll back note updates using the generated manifest:

```powershell
node scripts/sage-rag-notes.mjs --rollback=.planning/sage-rag/notes-YYYY-MM-DD.json --apply --confirm=rollback-sage-rag-notes
```

Apply activation after reviewing dry-run output:

```powershell
npm run sage:rag:activate -- --apply --confirm=activate-sage-rag
```

Roll back using the generated manifest:

```powershell
node scripts/sage-rag-activate.mjs --rollback=.planning/sage-rag/activation-YYYY-MM-DD.json --apply --confirm=rollback-sage-rag
```

Run the top-20 retrieval harness:

```powershell
npm run sage:rag:harness
```

Run the harness as a gate:

```powershell
npm run sage:rag:harness -- --strict
```

Run the stricter clean-top-3 check:

```powershell
npm run sage:rag:harness -- --strict-clean
```

## Activation Policy

Default activation filters (mirrors `SAFE_STUDENT_CATEGORIES` in [`scripts/lib/sage-rag-utils.mjs:4-13`](../../scripts/lib/sage-rag-utils.mjs#L4-L13)):

- `isActive = true`
- `usedBySage = false`
- `audience IN (STUDENT, BOTH)`
- `category IN (ORIENTATION, STUDENT_RESOURCE, STUDENT_REFERRAL, DOHS_FORM, CERTIFICATION_INFO, LMS_PLATFORM_GUIDE, READY_TO_WORK, PROGRAM_POLICY)`
- note quality is `good`

Category coverage in the current database:

- `READY_TO_WORK` and `PROGRAM_POLICY` are valid enum values (per `prisma/schema.prisma`) but currently have **zero
  rows**. Both are forward-looking — the policy is ready for them, no activation work happens until rows land.
- `TEACHER_GUIDE` (348 active rows) is deliberately excluded — would leak staff-only material into student chat.
- `PRESENTATION` (10 active rows, audience `BOTH`, all empty notes) is **also excluded by category whitelist**.
  These docs are student-visible by audience tag but were not included in the safe student set. If any are
  retroactively given substantive notes, this category gate must be lifted explicitly — they will not flow in
  automatically.

Do not activate `TEACHER_GUIDE` in this sprint.

## Kill Switch

Set `SAGE_RAG_ENABLED=false` to make `getDocumentContext()` return no program-document context without changing database rows.

If an immediate database rollback is required, prefer the activation manifest rollback command above. As a last-resort global rollback, disable all active Sage documents:

```sql
UPDATE visionquest."ProgramDocument"
SET "usedBySage" = false
WHERE "usedBySage" = true;
```

## Notes

The app caches Sage document lists for 300 seconds. After a direct script activation, running app instances may need up to 5 minutes before chat sees the new document set.
