# OKF Catalog — Phase 1 Findings & Reassessment

**Date:** 2026-06-30
**Status:** Phase 1 implemented and measured. **STOPPED to reassess** — measurement disproved the core integration hypothesis. No further code or prod writes pending a decision.
**Branch:** `feat/okf-org-knowledge-catalog`

> **⚠️ CORRECTION NOTICE (added 2026-06-30, after Codex round-4 review).** The doc-RAG numbers below (1/14 → 0/14, "broken upstream", root-cause #4) are **invalid**. `scripts/sage-rag-harness.mjs`'s `parseDocumentRefs()` only matched the no-passage doc-entry shape (`[Title]\nLink: …`); the live hybrid path emits the **chunk-citation shape** (`Link: …` first, no leading `[Title]` — see `formatEntry()` in `src/lib/sage/knowledge-base-server.ts`), which the parser silently missed entirely. Every chunk-retrieved doc counted as zero. Both the 1/14 baseline *and* the 0/14 after-sync number are parser artifacts — the apparent "regression" never happened.
>
> **Corrected numbers (fixed parser, same fixture, current prod):** doc-RAG top-1 **9/14**, top-3 **9/14**, cleanTop3 **6/14**, audienceLeakage **0**, noAnswer abstention **0/3**. Doc-RAG works; it was never "broken upstream." Root-cause #4 below is **retracted**. Prod's doc notes (re-embedded with the negation-polluted catalog text) are **not** in a degraded state — 9/14 top-1 with 0 leakage is healthy. No prod remediation is needed.
>
> The doc-RAG's *real*, now-visible gaps are the same shape as the form pipeline's: sibling pollution in top-3 (cleanTop3 6/14 — an answer-time disambiguation problem, not a retrieval problem) and no abstention on off-topic queries (noAnswer 0/3 — a retrieval-threshold fix, independent of the catalog).
>
> The **forms conclusion stands**: dropping the retrieval-index overlay is correct and independently confirmed (Codex reproduced baseline hybrid 12/12 top-1 vs. when-to-use-only-overlay 10/12). Root-causes #1–#3 below are unaffected by this correction.
>
> Full review: [`2026-06-30-okf-phase1-codex-review.md`](./2026-06-30-okf-phase1-codex-review.md). This file is kept as the historical record of the (partially wrong) Phase 1 measurement; treat the correction above as current truth.

---

## TL;DR

We built the OKF catalog (22 curated nodes) and wired its notes into the two retrieval pipelines (a form-search overlay + re-embedding `ProgramDocument.sageContextNote`). On measurement, **both pipelines regressed**:

| Pipeline | Baseline | After sync | Verdict |
|---|---|---|---|
| Form (`form-search`) top-1 | **12/12** | **10/12** (9/12 with when-NOT) | ⬇ regressed |
| Form clean-top-3 / forbiddenHits | 10/12 / 3 | 9/12 / 4 | ⬇ regressed |
| Doc-RAG (`ProgramDocument`) top-1 | 1/14 | 0/14 | ⬇ (both ≈ noise) |

**The catalog *content* is sound and approved. The mechanism — feeding curated notes into the retrieval *index* — is wrong.** The catalog's value is at **answer time** (Sage reading the notes to disambiguate already-retrieved candidates), not in the embedding/keyword index.

This is the "pit" the eval-first plan was designed to catch. It was caught before any of it shipped to *deployed* prod (the overlay is a local file; only the doc re-embed touched prod, negligibly).

---

## What was built (all committed on the branch)

**Sound / keep (the catalog + tooling):**
- `catalog/` — 22 approved OKF nodes (18 forms, 3 documents, 1 platform) with curated `description`, `tags`, `When to use`, `When NOT to use`, `Related` cross-links. Validator-clean.
- `src/lib/catalog/{schema,parse,generate,validate,sync,drift-audit}.ts` (+ tests, 29 passing) and `scripts/catalog/{generate,validate,sync,drift}.mjs` + npm scripts.
- `config/catalog-allowlist.json` (the ambiguous student-facing set).
- Phase-0 eval harnesses: `scripts/sage-rag-harness.mjs` (extended), `scripts/sage-form-harness.mjs` + fixtures `config/sage-rag-eval.json`, `config/sage-form-eval.json`.

**Questioned by measurement (the runtime integration):**
- The form-routing overlay (`buildFormRoutingOverlay` + `form-search.ts` consuming `config/form-routing.generated.json`).
- The dual-sink doc re-embed (`buildDocSyncManifest` → `ProgramDocument.sageContextNote` + re-embed).

---

## Phase 0 baselines (the measuring stick)

- **Doc-RAG** (config/sage-rag-eval.json, student): top1 **1/14**, top3 1/14, cleanTop3 13/14 (vanity — ≈0 docs retrieved), audienceLeakage 0, noAnswerPassed 3/3.
- **Form** (config/sage-form-eval.json): top1 **12/12**, top3 12/12, cleanTop3 **10/12**, forbiddenHits 3, method hybrid.
- Corpus: 50 active+embedded `ProgramDocument`s of 513 total (463 orphaned).

## Phase 1 measurement (after `catalog:sync --apply`)

- `--apply` wrote the 18-entry overlay + re-embedded **17/20** docs (3 skipped — their `teachers/guides/Hanbook Appendix/...` storageKeys don't resolve to bundled files; the skip-guard worked).
- **Form** dropped to top1 10/12, cleanTop3 9/12, forbiddenHits 4 (non-clean: attendance-contract, dress-code, dohs-release).
- **Doc-RAG** 1/14 → 0/14.
- Isolated test (overlay = when-to-use only, no negation): form top1 **10/12** — still below the 12/12 baseline.

---

## Root-cause analysis

1. **Retrievers ignore negation.** The `When NOT to use` text names sibling forms. Fed into an embedding/keyword index, "NOT the sign-in sheet" just adds the tokens *sign-in sheet* to this form — making it match the sibling's queries *more*. Negation is invisible to bag-of-words and vector similarity.
2. **The form pipeline is already optimal (12/12 top-1).** Even purely positive `when-to-use` prose *dilutes* the clean `title + description + category` signal and regresses ranking. There is no headroom to add to its index; additions only hurt.
3. **The form pipeline's real weakness is unfixable via the index.** Its only miss is occasionally ranking a *sibling* into the top-3 (cleanTop3 10/12). You cannot push a sibling *down* by adding text to a different form. Disambiguation is an **answer-time reasoning** task, not a retrieval task.
4. **The doc-RAG is broken upstream of notes.** 15/17 queries retrieve **zero** documents (Phase 0 finding) — the docs are embedded but filtered out (distance threshold / always-on static-knowledge context). Re-embedding the note doesn't change that; doc-RAG improvement requires **Phase 2** (metadata-aware SQL: use `category`/`certificationId`/`platformId`), not notes.

---

## The reframe

The OKF catalog is genuinely valuable curated knowledge. But its value to Sage is **at answer time**, not in the retrieval index:

- The form pipeline already returns the right form in the **top-3 every time** (12/12 top-3). The failure mode is Sage (or the ranker) picking a **sibling** that's also in the top-3. Injecting the catalog's `When to use` / `When NOT to use` for *those retrieved candidates* into Sage's prompt lets Sage reason "use X, not the sibling Y" — directly fixing the real weakness.
- This is the original OKF / Karpathy "LLM reads the wiki" vision — the catalog as something the agent **reads to decide**, not a vector to match against.

The curated note *does* have one legitimate index-adjacent use: as the human-readable **summary shown to Sage in the prompt** for a retrieved doc (better than the weak auto-summary). That's answer-time too — not retrieval ranking.

---

## Current state (honest inventory)

- **Prod (Supabase):** 17 `ProgramDocument` notes were re-embedded with the (negation-polluted) catalog notes → doc-RAG 1/14→0/14. **Negligible real impact** (alpha, no live students; both ≈0), but prod is in a degraded note state. **Remediation pending** the decision below (re-apply when-to-use-only, or restore baseline via re-ingest).
- **Deployed prod form-search:** **untouched.** The overlay is a local file, not committed/deployed.
- **Working tree (uncommitted):** `sync.ts` overlay → when-to-use-only; `sync.mjs` `--overlay-only` flag; local `config/form-routing.generated.json`. Not committed (WIP toward an approach now under review).
- **Committed on branch:** everything else (catalog, tooling, the original sync/overlay with when-NOT).

---

## Options forward

1. **Pivot to answer-time integration (recommended).** Abandon the embedding overlay + note-for-retrieval. New integration: when Sage retrieves form/doc candidates, inject their catalog `When to use` / `When NOT to use` into the prompt so Sage disambiguates. Re-define success as **answer-time selection accuracy** (does Sage present the *right* form when siblings are in the top-3?), not retrieval top-k. Remediate prod notes to when-to-use-only (better summaries, neutral retrieval). This needs a new eval (LLM-in-the-loop selection) and replaces Tasks 1.8/1.9's runtime wiring.
2. **Notes as prompt summaries only.** Re-apply doc notes as when-to-use-only (improves the summaries Sage already sees; neutral retrieval); drop the form overlay. Smaller; captures the summary-quality gain; leaves sibling-disambiguation for later.
3. **Revert runtime; catalog = dev/human asset.** Restore prod notes to baseline, shelve all Sage-runtime wiring, keep the 22-node catalog as the librarian/TOC for the dev agent + humans. Lowest risk; defers Sage gains to Phase 2.
4. **Reassess design first (this doc).** Take findings to review (Codex round) before more code.

---

## Questions for reviewers

1. Is the answer-time reframe correct — that the form pipeline's weakness (sibling in top-3) is a reasoning problem, not a retrieval problem, and best solved by injecting the catalog notes into Sage's prompt for retrieved candidates?
2. For answer-time integration, what's the right injection point — the existing chat context assembly (`src/lib/sage/system-prompts.ts` / `knowledge-base-server.ts`), or `getDirectFormAnswer`? And how to measure it without an LLM-in-the-loop eval becoming flaky?
3. Should the doc-RAG be left to Phase 2 (metadata-SQL) entirely, given notes don't move it?
4. Is the curated note still worth syncing to `sageContextNote` purely as the prompt summary (when-to-use-only), or does even that risk the same dilution when that field also feeds the doc embedding? (It does feed the embedding — so changing it for the summary unavoidably changes the vector. This coupling may itself need decoupling: a separate human-summary field vs. the embedded text.)
5. Did we miss a cheaper win — e.g., the 3 unresolved `teachers/guides/...` storageKey path mismatches (a registry fix) or the doc-RAG's always-on static-knowledge context (which made noAnswer and retrieval noisy)?

---

*The catalog and tooling are real, tested assets. Only the runtime-integration mechanism is in question. The eval-first + gate-by-gate process worked exactly as intended: it caught a wrong hypothesis with data before it reached deployed users.*
