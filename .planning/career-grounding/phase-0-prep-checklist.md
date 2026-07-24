# Phase 0 prep checklist — career grounding go-live

**Date:** 2026-07-23
**Status:** Prep complete on this branch. Live upload / seed / catalog apply remain **Britt-governed**.

## Done in-repo (this branch)

1. Staged student + orientation ECP copies from teacher SoT PDF
   - `docs-upload/students/ECP_AE_and_SPOKES_Fillable_FY25.pdf`
   - `docs-upload/orientation/ECP_AE_and_SPOKES_Fillable_FY25_Orientation.pdf`
2. Catalog nodes + allowlist keys for both ECP copies
3. Added `.md` → `text/markdown` to `scripts/upload-to-supabase.mjs` MIME_MAP (fy27 transcript risk)
4. Manifest §0a records hashes and storageKeys

## Britt executes next (runbook)

From a checkout whose `docs-upload/` mirrors the **full** bucket (orphan trap):

```powershell
# 1) Dry-run upload of career batch + ECP copies
node scripts/upload-to-supabase.mjs --dry-run

# 2) Live upload (only after dry-run looks right)
node scripts/upload-to-supabase.mjs

# 3) RAG sync — ALWAYS from full-tree checkout, never sparse worktree
node scripts/seed-sage-context.mjs --dry-run
node scripts/seed-sage-context.mjs

# 4) Catalog note sync
npm run catalog:sync
npm run catalog:sync -- --apply
```

Verify ECP student row audience is STUDENT and orientation row category is ORIENTATION before telling Sage to walk students through the form.
