# Session Handoff — OKF Org-Knowledge Catalog (VisionQuest)

**Date:** 2026-06-30
**Branch:** `feat/okf-org-knowledge-catalog` (off `main`)
**Status:** Phase 0 ✅ · Phase 1 built + measured · Codex round-4 review found the doc-RAG measurement itself was broken (harness parser bug) · **Direction decided: consolidate + answer-time pivot for forms, now in progress.**

> **⚠️ CORRECTION (2026-06-30, post Codex round-4):** The doc-RAG "1/14 → 0/14, broken upstream" finding in §4 below is **invalid** — `sage-rag-harness.mjs` only parsed one of two doc-entry shapes `formatEntry()` emits, silently missing every chunk-citation-path doc. Fixed parser + same fixture + current prod = doc-RAG top-1 **9/14**, cleanTop3 **6/14**, audienceLeakage **0**. Doc-RAG works; prod is healthy; **no doc-note remediation is needed.** The forms conclusion (drop the index overlay) was independently confirmed by Codex and stands. See the correction banner in [`2026-06-30-okf-phase1-findings-and-reassessment.md`](./specs/2026-06-30-okf-phase1-findings-and-reassessment.md) for full detail.

---

## 1. What this project is

Britt asked to research/plan/implement an **OKF (Open Knowledge Format) knowledge catalog** for VisionQuest — a git-tracked markdown catalog of organizational knowledge (forms, docs, certs, platforms) that acts as a "librarian," so the agent and Sage (the in-app AI coach) find the right file without reading the whole tree, and so Sage stops retrieving the **wrong form/doc**. Origin: a Gemini-drafted plan (OKF v0.1 + Karpathy LLM-wiki) the user brought in; Gemini never saw the codebase.

**Decomposition** (sub-projects): **A** = org-knowledge catalog (this work) · **B** = use `category`/`cert`/`platform` metadata in `sage_hybrid_search` SQL (doc-RAG fix, deferred) · **C** = dev-agent/codebase TOC (deferred) · plus expanded Sage duties (deferred).

## 2. How we got here (process)

Brainstorming → design spec → **3 Codex review rounds** (each caught real issues) → eval-first implementation plan → subagent-driven execution, gate-by-gate. Key design decisions: catalog is the curated source of routing notes that **syncs into the DB** (hard identity derived from `forms.ts`/DB = no drift; soft notes human-curated); coverage = ambiguous student-facing set + cert/platform nodes; **reject** per-student markdown profiles (FERPA). Eval-first so every change is measurable.

## 3. Current state — FULL inventory

**Committed on branch (18 commits, `8e3d993` … `0a3e980`):**
- Planning docs: design spec, impl plan, Codex round-1 review (all under `docs/superpowers/`).
- Phase 0: extended `scripts/sage-rag-harness.mjs` + new `scripts/sage-form-harness.mjs`; fixtures `config/sage-rag-eval.json`, `config/sage-form-eval.json`; baselines in `catalog/log.md`.
- Catalog tooling: `src/lib/catalog/{schema,parse,generate,validate,sync,drift-audit}.ts` (+ tests, **29 pass**) and `scripts/catalog/{generate,validate,sync,drift}.mjs` + npm scripts (`catalog:generate|validate|sync|drift`, `sage:form:harness`). Added dep: `gray-matter`.
- `config/catalog-allowlist.json` — the Phase-1 set (19 form ids → 18 after dropping `orientation-guide`; 3 docs; platform `aztec`).
- `catalog/` — **22 approved OKF nodes** (18 forms, 3 docs, 1 platform), validator-clean, all `vq_status: approved`.

**Uncommitted (WIP, do not assume final):**
- `src/lib/catalog/sync.ts` — `buildFormRoutingOverlay` changed to when-to-use-only (negation removed).
- `scripts/catalog/sync.mjs` — added `--overlay-only` flag.
- `config/form-routing.generated.json` — local overlay (untracked; never committed/deployed).
- New docs (this handoff + findings + Codex round-4 review) — uncommitted.

**Production (Supabase project `erdbdpgfirfbaoswwqby`):**
- `catalog:sync --apply` **ran**: 17/20 `ProgramDocument` notes re-embedded with the catalog notes; 3 skipped (path mismatch, see §6). **CORRECTED 2026-06-30:** the "Doc-RAG went 1/14→0/14, degraded state" claim below was a harness parser bug, not a real regression. With the fixed parser, current prod scores doc-RAG top-1 **9/14**, audienceLeakage **0** — healthy. **No remediation needed; nothing further to do here.**
- Deployed prod `form-search` is **untouched** (overlay never deployed).

## 4. The finding that stopped us (Phase 1 measurement)

Wiring catalog notes into the retrieval **index regressed both pipelines**:

| Pipeline | Baseline | After sync |
|---|---|---|
| Form `form-search` top-1 | 12/12 | 10/12 (9/12 with when-NOT) |
| Form clean-top-3 / forbiddenHits | 10/12 / 3 | 9/12 / 4 |
| Doc-RAG top-1 | 1/14 | 0/14 |

**Root cause:** (1) retrievers ignore negation → `When NOT to use` poisons a form with its siblings' keywords; (2) the form pipeline is already optimal (12/12) — any added prose dilutes its clean signal; (3) the form weakness (sibling in top-3) is an **answer-time reasoning** problem, unfixable via the index; (4) doc-RAG is broken upstream (docs not surfaced at all → needs Phase 2 metadata-SQL, not notes).

**Reframe:** the catalog's value is **answer-time** (Sage reads the notes to disambiguate already-retrieved candidates), not the retrieval index. This is the original OKF "LLM reads the wiki" model.

## 5. The open decision (from the reassessment doc)

`docs/superpowers/specs/2026-06-30-okf-phase1-findings-and-reassessment.md` lists 4 options:
1. **Answer-time pivot (recommended)** — inject catalog notes for retrieved candidates into Sage's prompt; redefine success as selection accuracy; remediate prod notes to when-to-use-only; replace Tasks 1.8/1.9's runtime wiring.
2. **Prompt-summaries-only** — re-apply doc notes as when-to-use-only (better summaries, neutral retrieval); drop the form overlay.
3. **Revert runtime; catalog = dev/human asset** — restore prod notes; keep the catalog for dev-agent/human navigation only; defer Sage gains to Phase 2.
4. **Reassess** (current step).

Britt's chosen next step: send the **Codex round-4 review** (`docs/superpowers/specs/2026-06-30-okf-phase1-codex-review.md`) for an independent read, then decide.

**Decision made (2026-06-30, after Codex round-4 + the parser-bug correction above):** consolidate (drop the form retrieval-index overlay; keep notes answer-time-only; fix `buildDocNote` to whenToUse-only) **plus** build the answer-time pivot for forms — inject catalog notes into `search_forms`'s `modelHint` (not a generic system prompt — Codex flagged that `getDirectFormAnswer` short-circuits before any model prompt is built, and the agent's own `modelHint` already exists in `tools.ts`) and bypass `getDirectFormAnswer` to the agent path for forms with measured sibling-confusion risk. Doc-RAG's Phase 2 (metadata-SQL) and its missing abstention (noAnswer 0/3) are explicitly deferred, not part of this round.

## 6. Known issues / threads to pick up

- **3 storageKey path mismatches:** `auth-release`, `non-discrimination`, `sign-in-sheet` have `forms.ts` storageKeys like `teachers/guides/Hanbook Appendix/Section 4/...` that don't resolve to bundled files on disk (real path drops `guides/`). The sync's skip-guard handled them safely; it's a **registry fix**, separate from the catalog.
- **`portfolio-checklist` vs `portfolio-checklist-tracking`:** two `forms.ts` ids sharing one PDF/title — Britt confirmed keep both; the sync **merges** their note for the shared doc. Possible registry dedup later.
- **`sageContextNote` coupling:** the field both feeds the doc embedding AND is shown to Sage as the summary — can't improve one without changing the other. May warrant decoupling (separate summary field) — open question for review.
- **Doc-RAG always-on context:** `getDocumentContext` returns static/snippet text for *every* query (even off-topic), which made `noAnswer`/retrieval noisy in Phase 0. Worth investigating.

## 7. Operating constraints to honor (Britt's rules)

- **Gate-by-gate**, surface don't absorb; preview/dry-run before any mutation; **commit only on request**.
- **FERPA (refined by Britt):** blank form templates may be described fully; protect only **filled** forms / student data + scanned filled examples. Vault/catalog stays PII-free.
- Prod doc notes are confirmed healthy (see correction above) — no prod writes are needed or planned for this round of work.
- The catalog markdown is flat (≤3-level depth rule, user-global). Hard identity is generator-derived; soft notes are human-curated; validator enforces no drift + no PII paths.
- MemPalace diary auto-saves every ~15 messages (Stop hook → `mempalace_diary_write`, agent_name `Claude`, topic `visionquest-okf-catalog`).

## 8. Where everything lives

| Thing | Path |
|---|---|
| Design spec | `docs/superpowers/specs/2026-06-30-okf-org-knowledge-catalog-design.md` |
| Implementation plan | `docs/superpowers/plans/2026-06-30-okf-org-knowledge-catalog.md` |
| Codex review round 1 (+correction banner) | `docs/superpowers/specs/2026-06-30-okf-catalog-codex-review.md` |
| **Findings & reassessment** | `docs/superpowers/specs/2026-06-30-okf-phase1-findings-and-reassessment.md` |
| **Codex review round 4** | `docs/superpowers/specs/2026-06-30-okf-phase1-codex-review.md` |
| SDD progress ledger | `<session scratchpad>/sdd-progress.md` (gitignored scratch; recover from `git log` if lost) |
| Catalog nodes | `catalog/**` |
| Catalog code / CLIs | `src/lib/catalog/*` · `scripts/catalog/*` |
| Eval harnesses / fixtures | `scripts/sage-{rag,form}-harness.mjs` · `config/sage-{rag,form}-eval.json` |
| Baselines | `catalog/log.md` |

## 9. Immediate next actions for whoever resumes

**Done (2026-06-30, this session):**
1. ~~Get Codex's round-4 review~~ — done; the parser-bug finding (P1) and the `getDirectFormAnswer` layer-targeting finding (P1b) were both independently verified against source before acting on them.
2. Direction picked (§5): consolidate + answer-time pivot for forms.
3. `sync.ts`/`form-search.ts` WIP resolved: overlay folding fully reverted out of the retrieval index; `buildFormRoutingOverlay` restored to carry `whenNotToUse` again (now answer-time-only); `buildDocNote` fixed to whenToUse-only (P2).
4. Reassessment + this handoff corrected in place with banners (no prod write needed — see §3).

**Remaining in this session:** build the answer-time injection (`src/lib/catalog/notes.ts` + `search_forms` modelHint enrichment + `getDirectFormAnswer` bypass), a deterministic selection harness, full verification, and an adversarial review pass before final commit. The catalog itself (22 nodes) is approved and sound — untouched by any of this.
