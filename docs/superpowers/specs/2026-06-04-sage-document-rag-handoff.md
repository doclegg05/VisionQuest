# Handoff — Sage Document RAG (finish the abandoned Phase-4 pipeline)

**Date:** 2026-06-04
**Status:** 🟢 Phase 0 complete · all decisions resolved · **FULL-AUTONOMY mode — cleared to build Phases 1–7**
**Owner / PM:** Britt (doclegg05)
**Reviewer/advisor:** separate Claude session — reviews, auto-merges, canary-deploys (see §2a)
**Working branch:** create `feat/rag-pipeline` **from `main`** before any Phase-1 code (do NOT build on `fix/ci-direct-url` — see §11)
**This is the single authoritative spec.** The advisor's separate kickoff is retired and merged in here (decision D).

---

## 1. Mission

Make Sage able to **read, quote, and cite the actual text** of VisionQuest's program/policy
documents — not just their titles/summaries. Today Sage only sees a hand-written
`sageContextNote` per document; the real document text is never extracted, chunked, or
embedded. Finish the abandoned Phase-4 RAG pipeline, FERPA-guarded.

**Origin:** Britt asked Sage "what is the policy for an instructor to take days off without
cause?" and Sage replied it had no access to HR policies. Investigation showed Sage was
telling the truth — it has document *names*, not *content*.

---

## 2. ✅ RESOLVED DECISIONS (Britt, 2026-06-04)

- **A — Missing instructor-leave policy → SHIP NOW, honest not-found.** Phase 0 verified
  (independently re-run by the reviewer) there is **no** instructor "days off without cause" /
  time-off / leave policy in the corpus. RAG ships against the corpus that *does* exist; the
  Phase-6 grounding prompt makes Sage say *"I don't have a document covering instructor leave —
  check with your coordinator / county HR"* instead of deflecting or guessing. Sourcing/uploading
  the real HR doc is a **separate content task**, not a blocker.
- **B — Image-only `WVAdultEd Personnel Confidentiality Agreement` → SKIP.** Signature form,
  ~0 Q&A value, fillable text variant exists. Excluded from RAG and **logged as skipped** (no
  silent drop). No OCR.
- **C — Document visibility → GATE BY AUDIENCE; RAG ignores `usedBySage`.** Retrieval pulls
  from all ingested chunks filtered by the requester's audience (`STUDENT` / `TEACHER` / `BOTH`).
  `usedBySage` stays only for the legacy summary path — **no flag-flipping needed**. Matches the
  "full corpus, audience-based access" scope.
- **D — Source of truth → THIS DOC.** The advisor's separate kickoff is retired; its review
  protocol is folded into the Operating Model (§2a) below.

## 2a. ⚙️ OPERATING MODEL — FULL AUTONOMY (VisionQuest policy, confirmed for this feature)

Gate-by-gate is **suspended** for this work. Flow:
- Agent builds **Phases 1–7 end-to-end** on `feat/rag-pipeline`, one commit per logical layer.
- Reviewer (separate session) does **one consolidated review → auto-merge → canary deploy with
  rollback**. No per-phase human pings; no `REVIEW.md` stop-loop.
- **The ONE hard-verified checkpoint = the PII redaction guard (Phase 5).** It must pass tests
  proving query PII is stripped **before any query text reaches cloud Gemini** — this is the
  "redacted" FERPA enforcement the autonomy policy is conditioned on. The chat-path cutover does
  **not** deploy until that verification is green.
- Still non-negotiable even under autonomy: **secret scan before every commit (abort on hit)**,
  **additive-only** schema/prompt edits, **canary + rollback** on deploy. See §4.

---

## 3. LOCKED decisions — do NOT re-open

| Decision | Choice |
|---|---|
| Embeddings | Gemini `text-embedding-004` (768-dim) for **both** corpus and query |
| FERPA posture | Cloud embeddings + a **PII query-redaction guard** (interim; local-Ollama migration is a tracked follow-up, **out of scope**) |
| Retrieval | **Always-on, threshold-gated hybrid search** (vector + full-text RRF). **Not** a `search_documents` tool |
| Chunk parent | New `DocumentChunk` table **FK → existing `ProgramDocument`** (513 rows are the registry). Do **not** create a new parent table |
| Vector index | **HNSW** (`vector_cosine_ops`), not IVFFlat |
| PDF/DOCX extract | **`unpdf`** (PDF) + **`mammoth`** (DOCX). Do **not** use `pdf-parse` |
| Jobs | Use existing **`BackgroundJob`** + `src/lib/jobs.ts`. Do **not** use the orphaned `EmbeddingJob` |
| Orphaned tables | `SourceDocument` / `ContentChunk` / `EmbeddingJob` (from closed PR #20) — **leave stale-but-harmless**, do not touch. Cleanup is a separate gated migration |
| Doc gating | **Audience-based** (`STUDENT`/`TEACHER`/`BOTH`); RAG ignores `usedBySage` (decision C) |

> Note (surfaced, not acted on): the installed `pdf-parse` is **v2.4.5** — a full rewrite, *not*
> the abandonware v1. Britt locked `unpdf` regardless; `pdf-parse` is left untouched in case
> it's used elsewhere.

---

## 4. Hard constraints (non-negotiable, even under full autonomy)

- **Additive only.** New table + indexes; no edits to existing columns. Prompt edits (Phase 6)
  are additive — verify **0 deletions** (`git diff --numstat`).
- **Secret scan before every commit; abort on a hit.** One commit per logical layer, conventional
  format. Never print secret values — paths/metadata/key-names only.
- **FERPA redaction guard is THE hard gate.** Query PII stripped before any query text reaches
  cloud Gemini, proven by tests, before the chat-path cutover deploys. (Generation-path exposure
  is pre-existing and out of scope — see §5.)
- **No silent drops.** Image-only / no-text PDFs must be **reported**, never skipped silently.
- **`DocumentChunk` is RLS-enabled, fail-closed** (writes service-role only) — mirror the
  `visionquest` RLS pattern. Don't weaken RLS anywhere else.
- **Deploy = canary + rollback.** No big-bang deploy of the chat-path change.
- Autonomy replaces the old per-phase human STOP gates; the reviewer auto-merges. The only things
  that still halt the cutover: a failing redaction-guard verification, a secret finding, or an
  RLS/schema regression.

---

## 5. Ground truth — current architecture & why Sage refused

- **Today's "RAG" is keyword matching over summaries.** `getDocumentContext()`
  (`src/lib/sage/knowledge-base-server.ts`) is wired into the chat prompt at
  `src/app/api/chat/send/route.ts:402`. For each `ProgramDocument` it injects only the
  short hand-written **`sageContextNote`** + a download link — **never the document's text**.
  The model comment says so: *"Short text summary Sage can read (avoids loading full PDF into
  prompt)."*
- **Static program facts** are hardcoded text constants in `src/lib/sage/knowledge-base.ts`
  (`SPOKES_KNOWLEDGE`, etc.), keyword-matched. The "Administrative Guide PY25" is only *named*
  there; its text was never ingested.
- **The real RAG pipeline was scaffolded then abandoned.** Tables `SourceDocument`,
  `ContentChunk`, `EmbeddingJob` exist in prod (0 rows) from **closed PR #20** via a phantom
  migration; they are **not** in `schema.prisma` and not referenced in `src/`. Documented in
  `prisma/migrations/00000000000000_baseline/migration.sql:4200` as orphaned + RLS
  fail-closed.
- **pgvector 0.8.0 is installed** (Supabase `public` schema) — foundation ready.
- **Two root causes of the refusal:** (1) document *text* is never extracted/embedded; and
  (2) nearly all teacher/admin/policy docs have **`usedBySage = false`**, so even the keyword
  layer ignores them. Sage's admin prompt actually *invites* policy Qs
  (`system-prompts.ts:361,451` — *"Reference policy when asked"*); it just had nothing to
  reference.
- **Existing prior design:** `docs/plans/supabase-optimization.md` lines 311–379 (original
  Phase-4). This work **supersedes it on the 8 locked forks** in §3.
- **FERPA context:** Sage generation runs on cloud Gemini today (pre-existing exposure). The
  PII query guard (Phase 5) only protects the *embedding* call — it does **not** fix the
  generation path; that's the separate local-Ollama migration (out of scope).

---

## 6. Phase 0 results (read-only corpus audit — DONE)

Ran a local, read-only audit (`scripts/_phase0-corpus-audit.mjs`) extracting text via `unpdf`
from 19 target docs (SPOKES Administrative Guide, all 16 WV Adult Ed Handbook sections,
Employee AUP, Personnel Confidentiality Agreement). **0 failures.**

- **Extraction works:** 18/19 produced clean text (Admin Guide = 77 pages / 150 k chars).
  `TT: undefined function` console lines are benign PDF.js font warnings.
- **No instructor leave policy exists in the corpus.** The only `"without cause"` hits (×2,
  Admin Guide) are about **grant cancellation** — *"A grant may be cancelled by the state…
  with or without cause."* Instructor leave appears only incidentally (replacing a resigned/
  on-leave instructor; homework during instructor vacation). The `§4` "absence policy" is
  **student** attendance, explicitly delegated to counties. → The real HR policy is almost
  certainly in a county-board / WVDE employment manual **not in VisionQuest**.
- **1 image-only doc:** `WVAdultEd Personnel Confidentiality Agreement` (5 chars from 2 pages).
- **Corpus is otherwise rich & answerable** — attendance, TABE/CASAS assessment, HSE diplomas,
  proxy hours, ESOL, corrections ed, SPOKES modules, grant administration. RAG remains a large
  net win for staff/program questions.
- **Caveat:** Phase 0 audited only 19 docs. The **full image-only census across all 513 docs**
  happens in the Phase 3 backfill dry-run manifest.

### ⚠️ Storage-credential blocker (important for whoever resumes)
`.env.local` does **not** contain prod Storage credentials — `STORAGE_ENDPOINT`,
`STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, and all `R2_*` are empty (only `STORAGE_REGION`
+ `STORAGE_BUCKET` are set). The prod creds live in **Render env vars**. So **you cannot
download prod Storage objects from this local machine.** Phase 0 worked because all target
PDFs are also bundled locally under **`docs-upload/teachers/`** (416 PDFs total). For Phase 2
ingestion that must run against prod Storage, run it where the creds exist (Render shell / the
internal API route in prod), or temporarily provision read creds locally — **ask Britt; do not
hunt for secrets.**

---

## 7. Build sequence (full autonomy — build Phases 1–7 on `feat/rag-pipeline`; reviewer does one consolidated review + auto-merge + canary)

| # | Phase | Status |
|---|---|---|
| 0 | **Corpus text audit** (read-only diagnostic) | ✅ **DONE** — see §6 |
| 1 | **Schema + migration** — add `DocumentChunk` to `schema.prisma` (`id`, `programDocumentId` FK→`ProgramDocument` `onDelete: Cascade`, `chunkIndex`, `content`, `tokenCount`, `pageNumber?`, `sectionTitle?`, `embedding vector(768)`, `fts tsvector` generated, `createdAt`). Indexes: **HNSW** on `embedding`, **GIN** on `fts`. Show migration SQL diff → **STOP before apply**. Verify on a Supabase branch; `prisma generate` clean; no drift. | ⏳ ready |
| 2 | **Ingestion lib** `src/lib/rag/ingest.ts` — download → extract (`unpdf`/`mammoth`) → structure-aware chunk (~512 tokens, 50 overlap, capture page + section for citations) → embed (Gemini, batched, exp-backoff) → upsert (replace existing chunks for that doc → idempotent). Driven by `BackgroundJob`. Verify: unit test on one doc → N chunks, all non-null embeddings; re-run replaces, not duplicates. | ⏳ |
| 3 | **Backfill the 513 docs** — emit a dry-run manifest (docs to ingest, est. chunk counts, docs with no extractable text) — verify against it (autonomous, no human STOP), then run; report parity (processed / chunks created / skipped + why). Verify counts == manifest; spot-check 3 docs. Retrieval is **audience-gated** (decision C); `usedBySage` does **not** gate RAG — no flag-flipping. | ⏳ |
| 4 | **Retrieval** `src/lib/rag/search.ts` — `searchDocuments(query)`: redact (Phase 5) → embed → Supabase hybrid RRF (`<=>` + FTS) → similarity threshold gate → top-K → **dedupe by `programDocumentId`** (the "Employee AUP ×3" problem) → format with `[Doc Title, p.N]` citations. Merge into `getDocumentContext()`; keep existing form-link logic. Verify: real policy query returns cited chunks; "hi how are you" returns nothing. | ⏳ |
| 5 | **FERPA query guard** `src/lib/rag/redact.ts` — `redactPII(query)`: strip SSN/phone/email/DOB/case#; match enrolled-student roster names. Applied **only** before the embedding call. Code comment documenting residual exposure (generation path still sends full convo to Gemini today). Verify: unit tests confirm identifiers stripped pre-embed. **HARD-VERIFIED gate — must be green before the chat-path cutover deploys (§2a/§4).** | ⏳ |
| 6 | **Grounding prompt fix** `src/lib/sage/system-prompts.ts` — additively append to staff/admin + student prompts: *"When document passages are provided below, answer from them and cite the source (e.g., 'Per the Administrative Guide, p.12…'). If the passages don't cover the question, say you couldn't find it in the available documents and suggest who to ask — do not guess."* Verify **0 deletions**. | ⏳ |
| 7 | **Eval** — harness with Britt's exact "instructor days off without cause" question + 10 policy questions, with/without RAG. Target **P50 retrieval < 200 ms**. Report results (feeds the reviewer's consolidated review). | ⏳ |

---

## 8. Key files, IDs, and environment

- **Supabase project id:** `erdbdpgfirfbaoswwqby` (`doclegg05's Project`, us-west-2, Postgres 17). MCP `supabase` server connected.
- **App data schema:** `visionquest` (RLS on). `ProgramDocument` = **513 rows** (the registry).
- **Stack:** Next.js 16 (App Router), Prisma 6, Supabase (Postgres + Storage), Gemini 2.5 Flash, Tailwind 4. Node v22.19. Hosted on Render (Starter plan).
- **Retrieval wiring:** `src/app/api/chat/send/route.ts:402` (injection point) · `src/lib/sage/knowledge-base-server.ts` (`getDocumentContext`) · `src/lib/sage/knowledge-base.ts` (form-link + static knowledge) · `src/lib/sage/system-prompts.ts` (prompts, 43 KB).
- **Storage helper:** `src/lib/storage.ts` — `downloadFile(storageKey)`, `getPresignedDownloadUrl()`; two backends (`STORAGE_*` Supabase = precedence, `R2_*` secondary). Bundled files: `docs-upload/`.
- **Deps present:** `mammoth@^1.12`, `pdf-parse@^2.4.5`, `@google/generative-ai@^0.24.1`, `@aws-sdk/client-s3`. **Added this session:** `unpdf` (1 package).
- **Embedding model:** Gemini `text-embedding-004`, **768-dim** (matches the locked vector size; dimension-compatible with `nomic-embed-text` for a future local migration → re-embed only, no schema change).

### Working-tree state (this session)
- Branch `fix/ci-direct-url`. **Nothing committed for this work.**
- Modified (additive, 0 deletions): `package.json`, `package-lock.json` (the `unpdf` install).
- Untracked: `scripts/_phase0-corpus-audit.mjs` (throwaway diagnostic — left in place per
  archive-don't-delete; safe to remove on Britt's explicit OK). **Local-only, reads
  `docs-upload/`, no network/creds/writes.**
- **A `feat/rag-pipeline` branch should be created before Phase 1 code lands.**

---

## 9. Known gotchas / watch-outs

- **No prod Storage creds locally** (§6) — Phase 2/3 ingestion against prod must run where creds exist.
- **`usedBySage = false`** on nearly all teacher/admin docs — must be flipped (audience-scoped, additive) or retrieval won't surface them.
- **Duplicate docs** — e.g. `WVAdultED Employee AUP` appears 3× at different storage keys; Phase 4 must **dedupe by `programDocumentId`**.
- **Messy filenames** — handbook sections have inconsistent suffixes (`Section_11_2025.2026_2.pdf`, `Section_13_..._updated_2.18.26.pdf`, `Section_15_2025_2026.pdf`). Don't assume a uniform pattern; read `storageKey` from the DB.
- **Phantom tables** (`SourceDocument`/`ContentChunk`/`EmbeddingJob`) — leave alone.
- **Security advisory (unrelated, surfaced earlier):** 15 tables in the **`public`** schema have RLS disabled (anon-exposed), but all are **0 rows** (legacy duplicates of `visionquest`). Harmless now; worth a separate gated cleanup. Do **not** auto-enable RLS without policies.

---

## 10. Artifacts from this session

- This handoff/spec: `docs/superpowers/specs/2026-06-04-sage-document-rag-handoff.md`
- Throwaway Phase-0 audit: `scripts/_phase0-corpus-audit.mjs`
- MemPalace diary entries (topic `visionquest-sage-rag`, agent `claude-code`): full
  investigation log, decisions, and verbatim findings.
- Background research synthesis (policy-grounded RAG patterns, FERPA-safe stacks, Supabase
  pgvector hybrid search, reusable repos) — captured in session; key takeaways folded into §3/§7.

---

## 11. Immediate next step (autonomous)

Decisions A–D are **resolved** (§2) and the operating model is **full autonomy** (§2a). Resume:

1. **Re-read this doc first** — the reviewer edited it; it is now the single source of truth.
2. **Branch cleanly from `main`, not from `fix/ci-direct-url`** (which is 8 unmerged CI/DB commits
   ahead — branching off it would drag that work into the RAG branch). Move only the 3 uncommitted
   Phase-0 changes over:
   `git stash -u` → `git fetch origin` → `git switch -c feat/rag-pipeline origin/main` → `git stash pop`
   ⚠️ **First check:** does the Phase-1 migration depend on the unmerged baseline-migration refactor
   on `fix/ci-direct-url`? If yes, get that merged to `main` first (or rebase onto it) so migration
   ordering stays clean. If no, branch from `main` as above.
3. Build **Phases 1–7 end-to-end**, one commit per logical layer, secret-scan before each commit.
4. Apply the Phase-1 migration on a Supabase **branch** first; verify `prisma generate` clean / no
   drift; then prod via the autonomous flow (no human STOP).
5. Phase 5 redaction guard is the **hard-verified checkpoint** — its tests must be green before the
   chat-path cutover. Reviewer then does the consolidated review → auto-merge → canary deploy.
