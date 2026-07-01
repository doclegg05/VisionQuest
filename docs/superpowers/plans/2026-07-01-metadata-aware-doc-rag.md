# Implementation Plan — Metadata-Aware Doc-RAG (Sub-project B)

**Date:** 2026-07-01
**Author:** Claude Code
**Design:** [../specs/2026-07-01-metadata-aware-doc-rag-design.md](../specs/2026-07-01-metadata-aware-doc-rag-design.md)
**Status:** **COMPLETE.** Track A shipped (default-OFF); Track B descoped on evidence. All work committed on `feat/metadata-aware-doc-rag` (local, stacked on PR #94).
**Operating rules:** gate-by-gate; commit-only-on-request; secret-scan before every commit; no prod mutation; no SQL migration; DB-live harnesses via `npx tsx`.

---

## Phase 0 — Baselines + metadata audit (read-only) ✅ `5299b0c`

- [x] Freeze eval / coverage / form-ranking / form-selection baselines → `.planning/sage-rag/B-phase0/`.
- [x] Add `scripts/sage-rag-metadata-audit.mjs` (coverage + canonicalization vs `spokes/{certifications,platforms}.ts`).
- [x] Diff eval failures → dominated by **form/orientation sibling bleed**, not cert/platform confusion.
- **Gate outcome:** coverage regression floor = **cleanTop3 37/40** (not 38); platform tags usable (42% canonical), cert tags too thin (16%, non-canonical). → ranking scoped to platform, cert deferred.

## Phase 1 — Track A: Abstention (default-OFF) ✅ `bb3ed71`

- [x] `getAbstentionDistance()` getter (env `SAGE_RAG_ABSTAIN_DISTANCE`, default 1 = OFF) + gate in `hybridSearchDocuments`: return `[]` when closest surviving cosine distance > floor; best-match-only; FTS-only never triggers; `[]` not `null`.
- [x] `--strict-noanswer` exit-gate in `scripts/sage-rag-harness.mjs`.
- [x] 6 new `expectNoContext` eval cases (now 9).
- [x] `scripts/sage-rag-calibrate-abstention.mjs` (limit matched to production `maxResults=3`).
- [x] +5 unit tests (16/16), eslint clean.
- **Calibrated floor `0.40`:** noAnswer 0/9 → **8/9**, zero regression on every metric (eval, coverage, forms 12/12 + 6/6). The 1 miss is an uncatchable near-miss (refund policy, dist 0.303 < hardest legit 0.383).
- **Verify:** `SAGE_RAG_ABSTAIN_DISTANCE=0.40 npm run sage:rag:harness -- --fixture=config/sage-rag-eval.json --strict-noanswer`; `npx tsx --test --experimental-test-module-mocks src/lib/sage/hybrid-retrieval.test.ts`.
- **Activation (operator):** set `SAGE_RAG_ABSTAIN_DISTANCE=0.40` in `.env.local` + Render. Ships OFF.

## Phase 2 — Track B: Ranking (DESCOPED) ✅ `1166fe7`

- [x] Gathered real platform/cert doc data; authored 6 platform-confusion eval cases (real storage keys).
- [x] Measured baseline **with no rerank**: all 6 pass (top1 ✓, cleanTop3 ✓, 0 leak).
- [x] **Descoped** — corpus is self-describing; text retrieval already resolves named-platform queries; metadata boost has no failure to fix. Kept the 6 cases as regression guards.
- [ ] ~~entity-resolution.ts~~ · ~~rerankByMetadata + widen fetch~~ · ~~boost tuning~~ — **not built** (would be speculative code).

## Non-regression invariants (held throughout)

- Form ranking **12/12**, form selection **6/6** (separate `form-search.ts` path — unaffected).
- `audienceLeakage` **0** on both RAG fixtures.
- Coverage `cleanTop3` ≥ **37/40**.
- Abstention default-OFF → zero behavior change on merge until the env var is set.

## Follow-ups

1. Operator: activate abstention (`SAGE_RAG_ABSTAIN_DISTANCE=0.40`).
2. Push branch + open PR (stacked on #94, or rebase onto `main` post-merge).
3. If Track B is ever revisited: pursue only the **implied-platform** query class, and only after the corpus gains untagged-but-metadata-rich docs.
