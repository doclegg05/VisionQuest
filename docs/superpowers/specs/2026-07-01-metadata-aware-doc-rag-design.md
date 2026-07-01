# Design Spec — Metadata-Aware Doc-RAG (Sub-project B)

**Date:** 2026-07-01
**Owner:** Britt Legg
**Author:** Claude Code
**Status:** **Track A (abstention) shipped, default-OFF.** **Track B (metadata ranking) descoped on evidence** — the corpus shows no measurable failure for it to fix.
**Follows:** [2026-06-30 OKF catalog design](./2026-06-30-okf-org-knowledge-catalog-design.md) §2, which forecast Sub-project B as "use `category`/`cert`/`platform` metadata in `sage_hybrid_search`."

---

## 1. Problem & goal

Sage retrieves program documents via a hybrid RRF search (`sage_hybrid_search` SQL → `hybridSearchDocuments` → `getDocumentContext` → `/api/chat/send`). The OKF Phase-1 correction established doc-RAG is **healthy, not broken**. Two measurable gaps remained on the eval fixture `config/sage-rag-eval.json`:

1. **Abstention (`noAnswer` 0/3):** off-topic queries surfaced weakly-related docs instead of nothing — a trust harm for a low-literacy adult-ed audience.
2. **Ranking (`cleanTop3` 6/14):** semantically-similar "sibling" docs pollute top-3, because retrieval ignores the `certificationId`/`platformId`/`category` metadata each doc carries.

Sub-project B set out to close both, each independently measured on the RAG harness. The metadata in question = **tags on Sage's reference documents** (which certification a doc teaches toward, which learning platform it belongs to; set at ingestion) — **not** student portfolio uploads.

## 2. Decisions (from brainstorming + gates)

| # | Decision | Rationale |
|---|---|---|
| D1 | Build **both** tracks, **sequenced**: abstention first, ranking second | Abstention is small, separable, metadata-free, default-off (zero merge risk); ranking is the harder metadata work |
| D2 | Ranking = **TypeScript post-retrieval rerank, audit-gated; NO SQL migration** | Recall-safe (only reorders); avoids the prod hazard that `CREATE OR REPLACE` migrations are invisible to Prisma diffing while `migrate:deploy` runs on Render |
| D3 | Branch `feat/metadata-aware-doc-rag` **stacked on** `feat/okf-org-knowledge-catalog` (PR #94), not off `main` | B's eval fixture + form harnesses live only on the catalog branch; rebase onto main once #94 merges |
| D4 | Ranking (if built) = **platform-scoped**; **cert deferred** | Phase-0 audit: `platformId` 42% coverage (mostly canonical) vs `certificationId` 16% (mostly non-canonical `intuit`/`mos`/`rtw`) |
| D5 | **Track B descoped** after direct measurement | 6 purpose-built platform-confusion cases all pass with no rerank; the corpus is self-describing, so a metadata boost has no failure to fix |

## 3. Verified current state (source-checked 2026-07-01)

- **Retrieval path:** `src/app/api/chat/send/route.ts` (~L429) → `getDocumentContext()` (`src/lib/sage/knowledge-base-server.ts:268-323`) → `hybridSearchDocuments()` / `getBestChunks()` (`src/lib/sage/hybrid-retrieval.ts`).
- **SQL** `visionquest.sage_hybrid_search(...)` (`prisma/migrations/20260610120300_.../migration.sql:17-97`) filters only `usedBySage`/`isActive`/`audience`; `category`/`certificationId`/`platformId` are stored + indexed but **unused** in the primary search. Returns ≤12 RRF-fused rows.
- **Three post-SQL cutoffs** via env getters in `hybrid-retrieval.ts`: `getMaxCosineDistance` (0.55), `getMinScoreRatio` (0), `getDistanceMargin` (0.04).
- **`getDocumentContext` fetches only `maxResults=3`** from SQL; the abstention gate therefore sees the top-3-by-score set (see `assembleContext` slice at `knowledge-base-server.ts:210`).
- **Two RAG fixtures (do not confuse):** `config/sage-rag-eval.json` = B's TARGET; `config/sage-rag-top-questions.json` (40 cases) = coverage/regression guard.
- **`ingest.ts` writes non-canonical ids** (`mos`, `intuit`, `rtw`, `learning-express`, `ready-to-work`) vs the canonical taxonomies in `src/lib/spokes/{certifications,platforms}.ts`.
- **Harnesses are DB-live** (Supabase + Gemini embeddings); run read-only against the `.env.local` DB. `npm test` is a Windows no-op (`$(git ls-files)` can't expand) — use `npx tsx --test <file>`.

## 4. Phase 0 — baselines + metadata audit (read-only gate)

Frozen under `.planning/sage-rag/B-phase0/` (commit `5299b0c`):

| Harness | top-1 | top-3 | cleanTop3 | audienceLeak | noAnswer |
|---|---|---|---|---|---|
| Eval (target) | 9/14 | 9/14 | 6/14 | 0 | 0/3 |
| Coverage (guard) | 36/40 | 39/40 | **37/40** | 0 | — |
| Form ranking | 12/12 | 12/12 | 10/12 | — | — |
| Form selection | — | — | — | — | 6/6 |

Coverage `cleanTop3` is **37/40** (the previously-committed 38 had drifted) — that is the regression floor.

**Metadata audit** (`scripts/sage-rag-metadata-audit.mjs`, 50 retrievable docs): `platformId` 21/50 (42%, mostly canonical; only `learning-express`/`ready-to-work` off); `certificationId` 8/50 (16%, mostly non-canonical). **Failure diagnosis:** the 8 eval `cleanTop3` misses are dominated by same-category **form/orientation sibling bleed** (attendance↔rights↔dress-code; portfolio-checklist siblings; a duplicate DoHS-release doc in two folders), not cert/platform confusion. → ranking's premise was already weak here.

## 5. Track A — Abstention (shipped, default-OFF)

**Mechanism** (`src/lib/sage/hybrid-retrieval.ts`, commit `bb3ed71`): `getAbstentionDistance()` getter (env `SAGE_RAG_ABSTAIN_DISTANCE`, default 1 = OFF) + a gate that returns `[]` (not `null`) when the closest surviving match's cosine distance exceeds the floor. Best-match-only (abstains only when *everything* is far); FTS-only rows never trigger; lives upstream of snippet fusion so staff snippets still surface. Returning `[]` (not `null`) prevents the keyword fallback from re-surfacing weak docs.

**Supporting:** `--strict-noanswer` harness exit-gate; 6 new `expectNoContext` eval cases (now 9); `scripts/sage-rag-calibrate-abstention.mjs`; +5 unit tests (16/16).

**Calibration** → **`SAGE_RAG_ABSTAIN_DISTANCE=0.40`**. Legit queries cluster at cosine distance 0.222–0.383; catchable off-topic at 0.407–0.449. Floor 0.40 sits in the gap:

| Metric | Baseline | @ 0.40 |
|---|---|---|
| Eval noAnswer | 0/9 | **8/9** |
| Eval top1 / top3 / cleanTop3 | 9 / 9 / 6 | 9 / 9 / 6 (unchanged) |
| Coverage strict / top3 / clean | 37 / 39 / 37 | 37 / 39 / 37 (unchanged) |
| Legit queries abstained (either fixture) | — | **0** |

The single unavoidable miss (`no-answer-near-miss-refund-policy`, distance 0.303) is *closer* to a real program-policy doc than the hardest legit query (0.383) — uncatchable by a distance floor without dropping legit recall (the "prefer over-answering, document it" case). Catching it later would need an LLM/keyword relevance check.

**Activation** is a separate operator step: set `SAGE_RAG_ABSTAIN_DISTANCE=0.40` in `.env.local` + Render. Ships OFF; behavior unchanged until set.

## 6. Track B — Ranking (descoped on evidence)

Per D4, Track B was scoped to platform-based rerank. Before building, I authored 6 purpose-built platform-confusion eval cases from the real corpus (Khan vs USA Learns "activity report"; Burlington vs LearningExpress "account setup"; Khan enroll; Burlington access) and measured the **current code with no rerank**:

| Platform case set | top-1 | cleanTop3 | leak |
|---|---|---|---|
| all 6 | ✓ | ✓ | 0 |

**All six already pass.** When a query names a platform, text/semantic retrieval already matches the correctly-named doc, and the 50-doc corpus is **self-describing** (platform/cert names live in doc titles), so the metadata signal is redundant with the text signal already winning. Combined with the Phase-0 diagnosis (real failures are form-sibling bleed, A's domain), a metadata boost has **no measurable failure to fix**.

**Decision:** do not build the rerank (it would be speculative code against simplicity-first). The 6 cases were kept as "platform-retrieval works" regression guards (commit `1166fe7`; eval now 20 expected + 9 noAnswer, baseline top1 15/20, cleanTop3 12/20).

**If revisited:** the only class metadata could help is **implied-platform** queries (platform not named, e.g. "where do I practice for my typing certificate?") — but those have fuzzy correct answers, and the self-describing corpus makes even those hard to pollute. Worth reconsidering only after the corpus gains untagged-but-metadata-rich docs.

## 7. Where everything lives

| Thing | Path / ref |
|---|---|
| Branch (local, stacked on #94) | `feat/metadata-aware-doc-rag` |
| Commits | `5299b0c` (Phase 0) · `bb3ed71` (Track A) · `1166fe7` (Track B cases + descope) |
| Abstention gate | `src/lib/sage/hybrid-retrieval.ts` (+ `.test.ts`) |
| Calibration / audit scripts | `scripts/sage-rag-calibrate-abstention.mjs` · `scripts/sage-rag-metadata-audit.mjs` |
| Harness gate | `scripts/sage-rag-harness.mjs` (`--strict-noanswer`) |
| Fixtures | `config/sage-rag-eval.json` (9 noAnswer + 6 platform cases) |
| Baselines/evidence | `.planning/sage-rag/B-phase0/*.json` |
| Impl plan | [../plans/2026-07-01-metadata-aware-doc-rag.md](../plans/2026-07-01-metadata-aware-doc-rag.md) |
| Memory | `project_metadata_aware_doc_rag` |

## 8. Operator action items

1. **Activate abstention when ready:** `SAGE_RAG_ABSTAIN_DISTANCE=0.40` in `.env.local` (local) + Render (prod).
2. **Push + PR:** branch is local, stacked on #94. Open as a stacked PR against the catalog branch, or rebase onto `main` after #94 merges.
