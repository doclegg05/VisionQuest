# "Hanbook" → "Handbook" Rename — Preview Manifest

**Status: APPLIED 2026-07-03 (approved by Britt: "Approved. Please fix all names").**
Execution record — all gates passed with exact counts:

- Bucket: **296/296 objects copied** to new keys via one-shot `maintenance-hanbook-rename` edge function (copy-only, JWT-gated, pair-validated server-side; stubbed to HTTP 410 after use — safe to delete from dashboard). Size parity 296/296, 0 mismatches. **Old 296 objects retained as orphans** per decision point 3 default — deleting them remains a separate gate.
- DB: **310/310 rows updated** in one transaction (collision precheck 0; would have rolled back on any other count). 0 typo'd keys remain.
- Repo: 7 files flipped (occurrence counts 1/1/1/5/5/22/2 → all 0); local mirror folder renamed + `_inventory.txt` regenerated (336 lines).
- Verified: storage tests 5/5, `catalog:sync --apply` 20/20, `catalog:drift` 0 findings, eslint clean.
- NOT done (still open): Finding B re-upload of 14 missing objects (decision point 4); deletion of the 296 orphans.

This document + [2026-07-03-hanbook-rename-manifest.json](./2026-07-03-hanbook-rename-manifest.json) (full old→new key pairs) were the approval artifact.

## Rename rule

Replace the exact phrase `Hanbook Appendix` → `Handbook Appendix`. Verified 2026-07-03 (read-only, recomputed from live DB + `storage.objects`): **every** `Hanbook` occurrence in the DB and bucket is this exact phrase — no other variants exist. The correctly-spelled `Handbook` entries (17 in DB, 17 in bucket) are the separate `teachers/guides/WV Adult Ed Handbook/` folder and are untouched.

## Measured scope (recomputed, not inherited)

| Surface | Count | Notes |
|---|---|---|
| `ProgramDocument.storageKey` rows | **310** | full list w/ ids in manifest JSON |
| Supabase `Uploads` bucket objects | **296** | metadata via `storage.objects` (read-only SQL) |
| DB rows with **no** bucket object | **14** | seeded from inventory but never uploaded — see Finding B |
| Bucket objects with no DB row | 0 | clean |
| Target-key collisions in bucket | 0 | no `Handbook Appendix` object pre-exists |
| Local mirror files under `docs-upload/teachers/Hanbook Appendix/` | 336 | = 296 uploaded + 14 never-uploaded + Section 16 remaps/skips |

### Repo references that must flip in the SAME change set
| File | Occurrences | What |
|---|---|---|
| `catalog/forms/auth-release.md` | 1 | frontmatter `vq_storage_key` ⚠️ catalog edit — needs its own explicit OK (standing instruction: don't modify catalog content) |
| `catalog/forms/non-discrimination.md` | 1 | same |
| `catalog/forms/sign-in-sheet.md` | 1 | same |
| `config/sage-rag-eval.json` | 5 | eval fixtures reference the keys — evals break if not flipped with DB |
| `src/lib/spokes/forms.ts` | 5 | hardcoded `storageKey` constants for onboarding forms |
| `scripts/seed-documents.mjs` | 22 | `TITLE_OVERRIDES` keys |
| `src/lib/storage.test.ts` | 2 | `REMAPPED_KEY` test constant (added 2026-07-03) |
| `docs-upload/teachers/Hanbook Appendix/` (local, gitignored) | folder | rename folder + regenerate `docs-upload/_inventory.txt` (336 typo'd lines of 511) |

### Referenced but EXCLUDED (historical documents — do not rewrite)
`docs/superpowers/2026-06-30-okf-catalog-handoff.md`, `docs/superpowers/specs/2026-06-30-okf-phase1-*.md` (2), `.planning/sage-rag/B-phase0/*.json` (5), `.planning/codebase/*` — history, listed so the exclusion is explicit, not silent.

### Confirmed NOT affected
`FileUpload.storageKey` (student uploads, `studentId/uuid.ext` format), `config/form-routing.generated.json` (no storage keys), document embeddings/chunks (keyed by `documentId`, not path), `BUNDLED_KEY_PREFIX_TO_LOCAL` map in `src/lib/storage.ts` (prefix-only, no typo string).

## Findings surfaced by the scope measurement

- **Finding A (context):** the 3 catalog "source bytes unavailable" nodes were fixed 2026-07-03 with a read-path fix in `src/lib/storage.ts` — independent of this rename; drift already 0. This rename is pure hygiene, nothing is functionally broken by the typo today.
- **Finding B (new):** 14 ProgramDocument rows point at bucket objects that were **never uploaded** (mostly Section 8 CCR PowerPoints; all 14 files exist in the local mirror). In prod, download of those 14 docs 404s (bundled fallback isn't deployed — `docs-upload/` is gitignored). Follow-up regardless of rename: re-run `scripts/upload-to-supabase.mjs` for those files — under the NEW keys if this rename is approved first.

## Proposed execution order (each step gated, verify before next)

1. **Bucket copy** — for each of the 296 objects: S3 `CopyObject` old→new key, then HEAD-verify new object count (296) and per-object size parity. Old objects left in place, so prod keeps serving throughout. Requires S3 creds (Supabase dashboard / Render env — not present locally; operator supplies at run time, values never printed).
2. **DB cutover** — single transaction: `UPDATE "visionquest"."ProgramDocument" SET "storageKey" = replace("storageKey", 'Hanbook Appendix', 'Handbook Appendix') WHERE "storageKey" LIKE '%Hanbook Appendix%'` — expect exactly 310 rows; rollback on any other count.
3. **Repo + local mirror commit** — flip the 7 repo files above (catalog frontmatter included, pending the explicit catalog-edit OK), rename the local folder, regenerate `_inventory.txt`; run `npx prisma generate`, `npx tsx --test src/lib/storage.test.ts`, `npm run catalog:sync -- --apply`, `npm run catalog:drift` (expect 0), `npx eslint src scripts`.
4. **Verify end-to-end** — DB `Hanbook` count = 0; bucket `Handbook` count = 313 (296 moved + 17 pre-existing); smoke-download one renamed doc in prod.
5. **Old-object cleanup — separate approval.** Default per archive-never-delete: leave the 296 old-key objects in place (storage is cheap; they become orphans). Deleting them is its own explicit gate.
6. **Optional follow-up:** upload the 14 missing objects under new keys (fixes Finding B).

## Decision points for Britt

1. Approve the rename at all? (Pure hygiene; ~296 copies + 310-row UPDATE + 7-file commit.)
2. Explicit OK to edit the 3 catalog frontmatter keys (required for consistency — `catalog:sync`/`drift` match nodes to DB rows by key).
3. Delete old bucket objects after verification, or leave as orphans (default: leave)?
4. Fold in the Finding-B re-upload of 14 missing objects, or track separately?

## Related, out of scope here
Orphaned near-duplicate `orientation/SPOKES_Rights_and_Responsibilites_FY26_Fillable.pdf` (missing "i") — same typo-cleanup family, tracked separately (referenced batch1-preview doc has not landed in this checkout as of 2026-07-03).
