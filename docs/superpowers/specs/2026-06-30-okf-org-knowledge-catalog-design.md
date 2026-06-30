# Design Spec — OKF Org-Knowledge Catalog (eval-first, narrow slice)

**Date:** 2026-06-30
**Owner:** Britt Legg
**Author:** Claude Code
**Status:** Design approved in brainstorming; pending implementation plan.
**Reviews folded in:** Codex adversarial review (2026-06-30) — all load-bearing findings verified against source and incorporated.

---

## 1. Problem & goal

Sage (VisionQuest's AI coach) "makes a lot of mistakes by retrieving incorrect forms or information." The owner wants an OKF-style (Open Knowledge Format) **librarian capability**: a catalog with tables of contents and quick markers so neither the dev agent nor Sage must read the whole filesystem to find the right file, and so Sage stops routing to the wrong form.

This spec covers the **first, narrow slice only** — an eval-backed routing catalog for the *ambiguous, student-facing* set — and defines the gated path to broader coverage.

## 2. The reframe (vs. the original Gemini-drafted plan)

The source plan was drafted without codebase access. Two corrections drive this design:

1. **Supplement, not replace, the existing RAG.** VisionQuest already has hybrid pgvector + full-text retrieval, a typed forms registry, per-file metadata, deterministic-first form lookup, and an auto-generated inventory. The leverage is a *curated home for routing knowledge* + *using metadata in the routing decision* — not a parallel brain.
2. **Reject per-student markdown profiles (FERPA).** Student state stays in RLS-protected Postgres. The catalog covers **organizational knowledge only.**

OKF serves **two consumers with different governance**, sharing one spine:

| Consumer | Wants | Governance |
|---|---|---|
| Dev/management agent | Navigable TOC over docs/code/memory | Git, PII-free, public |
| Sage (runtime) | Accurate routing to the right org form/doc | Student-facing, FERPA, audience-scoped |

### Decomposition (sequenced)

- **Sub-project A (this spec):** Org-Knowledge OKF Catalog — the shared spine, delivered in gated phases.
- **Sub-project B:** Use `category`/`cert`/`platform` metadata in `sage_hybrid_search` (real remaining gap).
- **Sub-project C:** Dev-agent librarian/TOC over `docs/` + code + the agent memory dir.
- **Ongoing:** Expanded Sage responsibilities (brainstorm separately).

## 3. Verified current state (source-checked 2026-06-30)

- **Hybrid RAG:** `ProgramDocument` (doc-level `embedding vector(768)`, `sageContextNote`, `category`, `audience`, `certificationId`, `platformId`, `usedBySage`, `isActive`) + `DocumentChunk` + `SageSnippet`. Retrieval = pgvector cosine + Postgres FTS fused via RRF in `prisma/migrations/20260610120300_add_sage_hybrid_search_function/migration.sql`.
- **Located root cause of wrong-form retrieval:** the SQL ranks only on the doc embedding + FTS over `title + sageContextNote`. `category`/`certificationId`/`platformId` are stored but **unused in the primary search** (only in the keyword fallback). → Sub-project B.
- **CORRECTION (Codex):** audience filtering happens **before** ranking (the `eligible` CTE at `migration.sql:40-46`), *not* after. There is **no** audience-ordering bug to fix. (An earlier exploration claim to the contrary is retracted.)
- **CRITICAL (Codex):** the doc-level vector embeds `title + sageContextNote` (`src/lib/sage/document-embedding.ts:46`, `buildDocEmbeddingText`). Therefore **any change to `sageContextNote` requires re-embedding**, or the semantic half of retrieval stays stale while only FTS improves.
- **Multiple writers to `sageContextNote`:** ingestion (`src/lib/sage/ingest.ts`), the teacher sage-context API (`src/app/api/teacher/documents/sage-context/route.ts`), and `scripts/sage-rag-notes.mjs`. A markdown validator cannot prevent DB-side drift; a DB-vs-catalog audit + single-writer discipline is required.
- **PII scanner is weak:** `containsPII()` (`src/lib/sage/extract.ts:104`) matches only SSN + case-number patterns; it does not catch names/addresses/phones/filled examples. `docs-upload/` holds **520 files (374 under `teachers/`, 82 scanned jpg/png that can't be regex-scanned at all)**.
- **Forms are a second pipeline:** `src/lib/spokes/form-search.ts` over the `FORMS[]` registry (`src/lib/spokes/forms.ts`) + `getDirectFormAnswer()` deterministic lookup.
- **Existing eval harness:** `scripts/sage-rag-harness.mjs` (supports expected storage keys + clean top-3 checks) — we extend it rather than build new.

## 4. Decisions (from brainstorming)

| # | Decision | Rationale |
|---|---|---|
| D1 | Build the org-knowledge catalog first | Shared spine for both consumers |
| D2 | Catalog is the **curated source** of soft routing metadata, **synced to DB** | Home for when-to-use/disambiguation; replaces weak auto-summaries; runtime stays DB-backed |
| D3 | Hard identity (storageKey/cert/platform/audience/category) **derived** from registry/DB; soft routing (notes/tags/description) catalog-owned | Anti-drift field-ownership split |
| D4 | Coverage **narrowed**: Phase 1 = *ambiguous student-facing `usedBySage` set* + the certs/platforms it links to (was "all docs-upload") | New evidence: 520 files / 374 teacher / 82 unscannable images makes full review a migration project, not a slice |
| D5 | Initial population = **agent drafts → human reviews → sync** | Reviewable artifact before mutation |
| D6 | Phase 1 content authored as **OKF markdown nodes** | Serves librarian goal now; cheap at ~20–40 nodes; no throwaway/migrate |

## 5. Phased plan (each phase gated on the prior)

### Phase 0 — Correct the record + build the measuring stick *(cheap, first)*
- Land the factual corrections from §3 (no code beyond docs).
- Extend `scripts/sage-rag-harness.mjs` (**document** RAG) into a trustworthy baseline measuring: **top-1, top-3, clean top-3, audience-leakage (student must never see TEACHER docs), close-confusion pairs, no-answer cases, low-literacy paraphrases.**
- **Baseline the form pipeline too** — Phase 1 also changes form ranking (via the generated overlay), but no form-ranking eval exists today: `src/lib/spokes/form-search.test.ts` asserts only the keyword *fallback* path, and `scripts/sage-agent-eval.mjs` measures tool *selection*, not whether `search_forms` returns the right form. Add a form eval with expected `form.id` **top-1 / top-3 / clean-top-3**, exercising the real semantic+keyword blend (with an embedding key), not just the fallback.
- Record **both** baselines. **Exit criterion:** reproducible document *and* form baselines committed.

### Phase 1 — Curated OKF routing nodes for the ambiguous student-facing set
- **Scope (~20–40 nodes):** `DFA-*` DoHS family, release forms, tech-use variants, student-profile variants, Ready-to-Work docs, + the certs/platforms they cross-link to. **Allowlist of explicit `usedBySage`, student-facing items only.**
- **Author as OKF markdown** (schema §6), agent-drafted → human-reviewed (`vq_status: draft → approved`).
- **Sync (the load-bearing fix):** for approved nodes, write the curated note to `ProgramDocument.sageContextNote`, **call `embedProgramDocument()` to re-embed**, and **`invalidatePrefix("sage:documents")`** so the cached fallback/keyword context can't serve stale notes (precedent: `ingest.ts:398`). Dry-run manifest → human approval → apply. Sync is the **single writer** for these nodes' notes.
- **Drift audit:** a check that flags any DB note that diverges from its approved catalog node (covers the other writers).
- **FERPA hardening:** student-facing allowlist; **forbid copying source examples/filled-form text into notes**; **exclude scanned-image docs from auto-drafting** (no reliable PII scan); mandatory human review before commit; reuse `containsPII()` as a backstop, not the primary guard.
- **Exit criterion:** measurable eval improvement vs. the Phase 0 baseline. **No improvement → stop and reassess; do not scale.**

### Phase 2 *(gated on Phase 1 result)* — Use metadata in routing
- Extend `sage_hybrid_search` to incorporate `category`/`certificationId`/`platformId` (filter and/or boost). Scope guided by which eval cases Phase 1 failed to move. This is Sub-project B; may prove the higher-ROI lever.

### Phase 3 *(gated)* — Expand coverage
- Broader documents, the teacher set, and the dev-agent TOC (Sub-project C) — only once OKF has demonstrably earned its maintenance cost.

## 6. Phase 1 OKF node schema

The single OKF hard rule is `type`. VisionQuest extensions carry routing identity.

```yaml
---
type: form                         # REQUIRED. form | program_document | certification | platform
title: Student Profile Form
description: Intake form capturing student contact + demographic details.
resource: forms/Student-Profile.pdf
tags: [onboarding, intake, required]
timestamp: 2026-06-30
vq_id: student-profile             # stable slug = filename (join key)
vq_audience: BOTH                  # ProgramDocAudience enum
vq_category: ORIENTATION           # ProgramDocCategory enum
vq_certification: ic3              # optional → certifications/ic3.md
vq_platform: gmetrix-and-learnkey  # optional → platforms/…
vq_storage_key: forms/Student-Profile.pdf
vq_status: draft                   # draft | approved — gates DB sync
---
## When to use
## When NOT to use      # explicit contrast with confusable siblings — the retrieval fix
## Related              # cross-links: enrolls in [IC3](../certifications/ic3.md) …
```

- **Hard identity** fields are derived/validated from `forms.ts` + DB (generator-owned).
- **Soft routing** (`description`, `tags`, body sections) is agent-drafted + human-curated (catalog-owned).
- Validator forbids any field being authored in two places.

**What actually moves retrieval in Phase 1:** only the re-embedded `sageContextNote` (sourced from the `When to use` section) changes document ranking. `tags`/`description` serve catalog navigation (dev agent / `index.md`) and the form-search overlay; they become *document*-retrieval signals only in Phase 2, when the SQL begins using metadata. This is intentional — Phase 1 deliberately changes one ranking input so the eval delta is attributable.

## 7. Location & structure

Flat — logical graph via markdown links, not folder depth (honors the owner's global `~/CLAUDE.md` ≤3-level rule; this is a *user-global* rule, not a repo rule).

```
catalog/                    ← level 1 (git-tracked, PII-free)
  index.md  log.md
  forms/        index.md  <slug>.md …
  documents/    index.md  <slug>.md …
  certifications/ index.md  <slug>.md …
  platforms/    index.md  <slug>.md …
```

## 8. Components (small, independently testable)

1. **Generator** — reads `forms.ts` + `ProgramDocument` rows + cert/platform taxonomy → emits/updates node skeletons for the Phase-1 allowlist. Idempotent: refreshes hard identity, never clobbers curated bodies. New nodes default `vq_status: draft`.
2. **Drafting pass** (one-time, agent-run) — drafts `description`/`tags`/`When to use`/`When NOT to use` from each source doc + its confusable siblings. Honors the no-copy FERPA rule; skips scanned images.
3. **Validator** (the `okf-validate` equivalent; wired into `npx eslint .` / CI) — fails on: missing `type`; hard-field drift vs. source; broken cross-links; parity violations within the allowlist; a node sourced from a student/PII path.
4. **Sync** — approved nodes only → write `sageContextNote` **+ re-embed** via `embedProgramDocument()` **+ `invalidatePrefix("sage:documents")`**; generated form-routing overlay (`config/form-routing.generated.json`, mirroring `config/sage-overrides.json`) for `form-search.ts`. Dry-run manifest → approve → apply. Single writer.
   - **Runtime freshness:** `form-search.ts` builds its embedding index **once per process**, so an overlay that changes ranking/embedding text has no effect until the cache resets. The plan must pick and state a strategy — redeploy/restart, a runtime loader, or calling the existing `__resetFormEmbeddingCache()`.
5. **Drift audit** — reports DB notes that diverge from approved catalog nodes.

*(No per-request file IO; no new `ProgramDocument` columns in Phase 1 — `sageContextNote` already exists and is embedded.)*

## 9. Data flow

```
forms.ts + ProgramDocument + cert/platform taxonomy   (allowlist only)
   │ generate (hard fields)            + agent drafts (soft fields, no PII copy)
   ▼
catalog/**.md ───────────────────────────────► dev agent navigates (index.md)
   │ human review: draft → approved
   ▼
validate  (type / drift / links / parity / no-PII-path)
   │ sync (dry-run → approve → apply):  write sageContextNote  +  RE-EMBED
   ▼
ProgramDocument (note + fresh vector)  +  form-routing overlay
   └────────► Sage runtime retrieval (DB-backed, plumbing unchanged)
   drift-audit ⇄ catalog  (catches other writers)
```

## 10. Testing (TDD)

Validator tests first. Then: generator idempotency + hard-field derivation; sync correctness (approved-only, **re-embed invoked**, dry-run manifest, idempotent); drift-audit detects a planted divergence; FERPA guard rejects a student-path node and a note containing a copied example; round-trip generate→validate→approve→sync integration test. Plus the Phase 0 eval harness extension.

## 11. Out of scope / YAGNI

`viz.html` visualizer · the Phase-2 SQL change (separate, gated) · dev-agent codebase TOC (Sub-project C) · **per-student profile nodes** (one markdown file per student / PII — never; note the *Student Profile **Form*** is org content and **is** catalogued) · new `ProgramDocument` columns · unifying the forms and documents pipelines · any per-request file IO.

## 12. Open items for the implementation plan

- Exact membership of the Phase-1 allowlist (enumerate the confusable `usedBySage` items from the eval).
- Generator/validator/sync location: `scripts/catalog/` vs `src/lib/catalog/` (lean to `scripts/` for the generator/validator + a thin `src/lib/catalog/` for sync types).
- Drift-audit surfacing: CI check vs. teacher-tools report.
- Whether the form overlay or `sageContextNote` is the primary sink for items that exist in *both* `forms.ts` and `ProgramDocument` (reconcile to one node, one sync target).
- Form-overlay **reload strategy** (redeploy vs runtime loader vs `__resetFormEmbeddingCache()`) and where it's triggered after sync.
