# Codex Review Request — OKF Catalog Phase 1: integration regressed, reassessing

**Date:** 2026-06-30
**Audience:** Codex (independent reviewer)
**Author:** Claude Code
**Branch:** `feat/okf-org-knowledge-catalog`
**Companion (full detail):** [`2026-06-30-okf-phase1-findings-and-reassessment.md`](./2026-06-30-okf-phase1-findings-and-reassessment.md)

---

## 0. What I'm asking

You reviewed the OKF catalog design across three earlier rounds (it shipped a much-improved plan). We then **implemented** it and **measured** it. The implementation works; the **design hypothesis was wrong** — wiring catalog notes into the retrieval index *regressed* both pipelines. I've written a reassessment and a recommended pivot. **Please attack the reassessment**: is the root-cause analysis right, is the recommended pivot right, and what am I still missing? Be adversarial — the flawed hypothesis was mine, so an independent check matters.

Concrete questions in §5. If you have repo access, verify the claims against the cited files.

---

## 1. What was built & measured

Catalog (sound, approved, committed): 22 OKF nodes in `catalog/` (18 forms, 3 docs, 1 platform), each with curated `description`/`tags`/`When to use`/`When NOT to use`/`Related`. Tooling in `src/lib/catalog/*` + `scripts/catalog/*` (29 tests pass, validator clean).

Integration (the part under review): a form-search **overlay** (`buildFormRoutingOverlay` in `src/lib/catalog/sync.ts`, consumed by `src/lib/spokes/form-search.ts`) + **dual-sink** re-embedding of `ProgramDocument.sageContextNote` (`buildDocSyncManifest` → `src/lib/sage/document-embedding.ts`).

Eval (Phase 0 baselines → Phase 1 after `catalog:sync --apply`):

| Pipeline | Baseline | After | 
|---|---|---|
| Form `form-search` top-1 | **12/12** | **10/12** (9/12 with when-NOT text) |
| Form clean-top-3 / forbiddenHits | 10/12 / 3 | 9/12 / 4 |
| Doc-RAG `ProgramDocument` top-1 | 1/14 | 0/14 (both ≈ noise) |

Isolated re-test with overlay = **when-to-use only** (negation removed): form top-1 = **10/12** — still below the 12/12 baseline.

Harnesses: `scripts/sage-rag-harness.mjs`, `scripts/sage-form-harness.mjs`; fixtures `config/sage-rag-eval.json`, `config/sage-form-eval.json`.

---

## 2. My root-cause analysis (challenge this)

1. **Retrievers ignore negation.** `When NOT to use` names sibling forms; fed to an embedding/keyword index it adds the *sibling's* tokens to this form → matches the sibling's queries more. Negation is invisible to vector/BoW similarity.
2. **The form pipeline is already optimal (12/12).** Even positive `when-to-use` prose dilutes the clean `title + description + category` signal and regresses ranking — no headroom to add to its index.
3. **The form weakness is unfixable via the index.** Its only miss is ranking a *sibling* into the top-3 (cleanTop3 10/12). You cannot push a sibling *down* by adding text to a different form — it's an **answer-time reasoning** task.
4. **Doc-RAG is broken upstream of notes.** 15/17 queries retrieve **zero** docs (embedded but filtered by distance / drowned by always-on static-knowledge context). Notes don't change that; doc-RAG needs **Phase 2** (metadata-aware SQL using `category`/`certificationId`/`platformId`).

## 3. My reframe + recommendation (challenge this)

The catalog's value is **answer-time**, not retrieval-index: inject the `When to use`/`When NOT to use` of the *already-retrieved* candidates into Sage's prompt so it disambiguates (the form pipeline returns the right form in top-3 every time; the failure is Sage/ranker picking a sibling that's also there). This is the original OKF "LLM reads the wiki" model.

**Recommended option:** pivot Tasks 1.8/1.9 from index-integration to answer-time prompt-injection; remediate the 17 prod doc notes to when-to-use-only; redefine success as answer-time selection accuracy. (Full options list in the companion doc.)

---

## 4. State to be aware of

- **Prod:** 17 `ProgramDocument` notes re-embedded with polluted notes (doc-RAG 1/14→0/14). Negligible (alpha, no students). **Remediation pending a decision — prod will not be touched again until then.**
- **Deployed form-search untouched** — the overlay is a local file, never committed/deployed.
- **Uncommitted WIP:** `sync.ts` overlay→when-to-use-only, `sync.mjs` `--overlay-only`, local `config/form-routing.generated.json`.

---

## 5. Questions for you

1. Is the negation-pollution + "already-optimal pipeline has no index headroom" analysis correct? Any flaw in the measurement (e.g., fixture bias, the keyword path dominating, cache effects)?
2. Is "form disambiguation is answer-time, not retrieval" right — or is there an index-side technique I'm dismissing (e.g., per-form negative boosts, a re-ranker, metadata filters) that could fix the sibling-in-top-3 without an LLM-in-the-loop?
3. For the answer-time pivot: best injection point — `src/lib/sage/system-prompts.ts` / `knowledge-base-server.ts` (chat context) vs `getDirectFormAnswer`? How would you measure selection accuracy reliably (deterministic proxy vs LLM judge)?
4. The `sageContextNote` field both (a) feeds the doc embedding and (b) is shown to Sage as the summary. That coupling means we can't improve the human summary without changing the vector. Should we **decouple** them (a separate non-embedded summary field)? Is that worth a migration?
5. Cheaper wins we're skipping: the 3 `teachers/guides/Hanbook Appendix/...` storageKey path mismatches (registry fix), or the always-on static-knowledge context that makes doc-RAG/no-answer noisy — is either the higher-ROI next move than the whole pivot?
6. Given all this, would you ship the catalog as a dev/human asset + defer all Sage-runtime gains to Phase 2, or pursue the answer-time pivot now?

Disagreement is the point. Cite the file/section you're critiquing.
