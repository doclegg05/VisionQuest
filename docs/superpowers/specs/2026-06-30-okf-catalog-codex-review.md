# Second-Opinion Review Request — VisionQuest OKF Knowledge Catalog (Sub-project A)

**Date:** 2026-06-30
**Audience:** Codex (independent reviewer)
**Author:** Claude Code (after brainstorming with the project owner, Britt)
**Status:** Design proposed, awaiting implementation plan. **Nothing has been built or changed yet.**

> **⚠️ CORRECTION NOTICE (added 2026-06-30, after Codex's review).** Two claims below were verified WRONG against source and are corrected in the design spec [`2026-06-30-okf-org-knowledge-catalog-design.md`](./2026-06-30-okf-org-knowledge-catalog-design.md):
> 1. **Audience filtering happens BEFORE ranking** (`migration.sql:40-46`) — §3.2 / §8's "applied after ranking" is retracted; there is no audience-ordering bug.
> 2. **The doc-level embedding includes `sageContextNote`** (`document-embedding.ts:46`) — so syncing a note REQUIRES re-embedding; §5.4's "runtime plumbing untouched / text-only write" understates this.
>
> The **design spec is the current source of truth.** Treat this file as the historical review request (Codex round 1).

---

## 0. What I'm asking you to do

Please act as an **adversarial reviewer**, not a cheerleader. The owner explicitly wants us to "continue the loop until the design avoids falling into a pit of broken strategy or code." So:

- Try to find where this design **breaks, drifts, or creates hidden maintenance cost**.
- Challenge the **sequencing** (does Sub-project A deliver value on its own, or is it inert until B?).
- Sanity-check the **FERPA / data-governance** reasoning.
- Propose a **simpler alternative** if one exists (YAGNI).
- Flag anything we **missed**, especially additional responsibilities the runtime AI ("Sage") could safely take on.

Concrete review questions are in **Section 8**. If you have access to the VisionQuest repo, please verify the current-state claims in Section 3 against the cited file paths — they were mapped by exploration agents on 2026-06-30 and I want them independently confirmed.

---

## 1. Background & goal

**VisionQuest** is an AI-coach-driven program portal for SPOKES workforce development (adults on TANF/SNAP). The AI coach is named **"Sage."** Stack: Next.js 16 (App Router), TypeScript, Prisma 6, Supabase (Postgres + Storage), Google Gemini, Tailwind 4. Postgres uses pgvector and row-level security (RLS). Students are TANF/SNAP recipients, so **FERPA + PII handling is a hard constraint**.

The owner wants a **"librarian" capability**: an agent that catalogs every organizational file, builds tables of contents and quickly-identifiable markers, so neither the dev agent nor Sage has to read the whole filesystem to find the right file — and so Sage stops retrieving the **wrong** form/document (the owner's chief complaint about the current RAG: "it's still clunky and the AI makes a lot of mistakes by retrieving incorrect forms or information").

The proposed approach comes from Google Cloud's **Open Knowledge Format (OKF v0.1)** + Andrej Karpathy's "LLM-wiki" pattern. The owner forked the reference repo (`doclegg05/OKF_knowledge-catalog`).

### OKF v0.1 spec (verified from Google Cloud's announcement)

- **One hard rule:** every concept file has a `type` field in YAML frontmatter. Nothing else is required.
- **Six reserved (queryable) fields:** `type` (required), `title`, `description`, `resource`, `tags`, `timestamp`.
- **Conventions, not rules:** `index.md` for progressive disclosure as an agent walks the hierarchy; `log.md` for dated change history; ordinary markdown cross-links form the knowledge *graph* (richer than folder parent/child).
- **Three principles:** minimally opinionated · producer/consumer independence · "format, not platform" (just markdown + files + YAML).
- **Reference tooling is proof-of-concept:** the enrichment agent is **BigQuery-specific** (not reusable here); `viz.html` is a self-contained client-side graph renderer; plus a validator (`okf-validate`).

---

## 2. The key reframe (why we are NOT following the original plan literally)

The owner's source plan (drafted by Gemini, which **never had access to the codebase**) framed this as "OKF vs RAG" and proposed, among other things, storing **per-student mutable profiles as markdown files** (`/students/student_0842.md`) holding names, progress, resume state, and job-application logs.

Two corrections drive our design:

1. **OKF should supplement, not replace, the existing RAG** — agreed with Gemini. But VisionQuest *already has* most of what Gemini proposed to "introduce" (a typed forms registry, per-file metadata, deterministic-first routing, an auto-generated inventory). The real gap is different (see Section 3).
2. **The student-profile markdown nodes are a FERPA landmine and are rejected.** Student state already lives in RLS-protected Postgres (`Student`, `Goal`, `Certification`, `SageInsight`, `FileUpload`). Putting PII in flat files violates the project's hard rules. **Student data stays in the DB. The catalog covers organizational knowledge only.**

**OKF actually serves two different consumers with different governance:**

| Consumer | Wants | Governance |
|---|---|---|
| **Dev/management agent** (Claude Code, autopilot) | A navigable TOC over docs/code/memory so it doesn't read the whole tree | Git-tracked, **PII-free**, public |
| **Sage** (in-app runtime AI) | Accurate, deterministic routing to the right org form/doc | Student-facing, **FERPA-governed**, audience-scoped |

They share one spine — a catalog of **organizational** knowledge — but are otherwise distinct. We decomposed the work accordingly.

### Decomposition

- **Sub-project A (this doc): Org-Knowledge OKF Catalog** — the shared spine. ← *review target*
- **Sub-project B: Fix Sage retrieval** — make `sage_hybrid_search` actually *use* the catalog metadata (category/cert/platform) and filter audience before ranking.
- **Sub-project C: Dev-agent librarian/TOC** — OKF index over `docs/` + code subsystems + the agent memory dir.
- **Ongoing: Expanded Sage responsibilities** — to brainstorm separately.

---

## 3. Current system — VERIFIED ground truth (please confirm against repo)

> Mapped by exploration agents on 2026-06-30. File paths are relative to repo root.

### 3.1 Existing hybrid RAG (this already exists and works "somewhat")

- **Models (Prisma, `prisma/schema.prisma`):**
  - `ProgramDocument` — program docs for Sage; fields include `title`, `storageKey`, `sageContextNote`, `category` (enum `ProgramDocCategory`), `audience` (enum `ProgramDocAudience`: STUDENT/TEACHER/BOTH), `certificationId`, `platformId`, `usedBySage`, `isActive`, `embedding vector(768)`.
  - `DocumentChunk` — ~512-token chunks with `embedding vector(768)`, `pageNumber`, `sectionTitle`.
  - `SageSnippet` — staff-authored Q&A pairs, keyword-matched.
- **Embeddings:** `src/lib/ai/embeddings.ts` — Gemini `gemini-embedding-001`, 768-dim, L2-normalized client-side.
- **Chunking:** `src/lib/sage/chunking.ts` — paragraph→sentence→hard-cut, page-aware, heading detection.
- **Retrieval:** `src/lib/sage/hybrid-retrieval.ts` + the SQL function in `prisma/migrations/.../add_sage_hybrid_search_function/migration.sql`. Hybrid = pgvector cosine + Postgres full-text, fused via **Reciprocal Rank Fusion (RRF)**.
- **Context injection:** `src/lib/sage/knowledge-base-server.ts` (`getDocumentContext`) → formatted block appended to Sage's system prompt. Token budget ~6000 chars (2000 compact).
- **Ingestion/classification:** `src/lib/sage/ingest.ts` (`syncSageDocuments`, `classifyFile`) — walks `docs-upload/`, classifies by **folder convention** into category/audience/cert/platform, extracts text, **PII-scans (skips if hit)**, Gemini-summarizes into `sageContextNote`, embeds. Per-file overrides in `config/sage-overrides.json`. Generates `docs-upload/_inventory.txt` (a flat 62KB catalog).

### 3.2 The located root cause of "wrong form/doc retrieved"

**`sage_hybrid_search()` ignores the metadata the system already stores.** It ranks purely on semantic distance + full-text over `title + sageContextNote`. The `category`, `certificationId`, and `platformId` fields are populated at ingest but **are not used in the primary search** — they only participate in the *keyword fallback path* (`scoreDocument()` in `knowledge-base-server.ts`) that runs when the embedding API is down. So Sage routes with its eyes half-closed.

Other contributing causes found:
- **Audience filter is applied *after* ranking**, so teacher docs can occupy top-3 slots and crowd out student docs.
- **Folder-based classification is fragile** with no post-ingest UI to correct a misfiled doc.
- **`sageContextNote` is auto-generated** by a mediocre Gemini summarization pass (or ad-hoc `sage-overrides.json`) — there is no structured, curated "when to use this / not that" knowledge anywhere.
- **A second, separate retrieval system exists for forms:** `src/lib/spokes/form-search.ts` (hybrid semantic+keyword over the `FORMS[]` registry in `src/lib/spokes/forms.ts`, 40+ `SpokesForm` objects) plus `getDirectFormAnswer()` (deterministic lookup, no AI). So "forms" and "documents" are two parallel pipelines — part of why results feel inconsistent.

### 3.3 Sage prompt assembly & memory (for context)

- System prompt is built from typed `PromptSection[]` in `src/lib/sage/system-prompts.ts` (personality, guardrails, program knowledge, stage procedure, per-student situational snapshot, a self-metrics line from a "wager" loop, RAG grounding, etc.). Student-supplied fields are bracket-delimited and sanitized against prompt injection.
- Per-student context: `src/lib/sage/context-bundle.ts`, `src/lib/chat/context.ts`.
- Two memory systems already exist: a **file-based agent memory** (`<claude projects>/.../memory/`, ~35 markdown files + `MEMORY.md` index) and **MemPalace** (an MCP semantic-recall server). FERPA dual-track routing sends sensitive inference to local AI.

**Implication:** the building blocks Gemini wanted to "add" largely exist. The leverage is in (a) a **curated home for routing knowledge** and (b) **using metadata in the routing decision** — not a parallel brain.

---

## 4. Decisions already made (with the owner)

1. **Build order:** the **Org-Knowledge OKF Catalog (Sub-project A)** first — it's the shared spine.
2. **Catalog role:** it is the **curated source of routing metadata** (descriptions, tags, when-to-use / disambiguation notes) and **syncs INTO the DB**. It *replaces* the weak auto-summaries + `sage-overrides.json` as the source of `sageContextNote`. **Hard identity** (storageKey, cert, platform, audience, category) stays **derived** from `forms.ts`/folders, so the catalog cannot drift from reality. **Runtime keeps reading the DB — no new request-time file IO.**
3. **Coverage:** organizational knowledge (forms + all of `docs-upload/`) **plus certification and platform nodes** so the graph carries `form → cert → platform` cross-links. **Excludes** student uploads/PII (`FileUpload`) and the codebase (that's Sub-project C).
4. **Initial population:** **agent drafts → human reviews → sync.** A coding agent reads each form/doc and drafts frontmatter + when-to-use/when-NOT-to-use notes as `vq_status: draft`; a human reviews/edits the markdown; only then does it sync to the DB. The draft catalog is itself the reviewable artifact the owner's rules require before any mutation.

---

## 5. Proposed design — Sub-project A

### 5.1 Success criteria (measurable)

- Every org file + form + cert + platform has exactly one catalog node; validator passes with **0 missing `type`** and **0 drift** vs. `forms.ts`/DB.
- Round-trip parity: **no orphan nodes, no uncatalogued org files**.
- Curated when-to-use notes synced for the known-ambiguous set (esp. the `DFA-*` DoHS form family).
- A 20-item "which form/doc?" eval set exists with a recorded **baseline** (the measuring stick Sub-project B will move).
- The dev agent can answer "where is the X form / what doc covers Y" from `catalog/index.md` alone.

### 5.2 Location & structure (honors the repo rule: never nest > 3 levels from root)

OKF favors deep nesting; the repo forbids it. So the catalog is **flat — logical graph via links, not folders.** Each doc gets one node regardless of its source path depth; the source path lives in frontmatter.

```
catalog/                    ← level 1 (git-tracked, PII-free)
  index.md                  ← root TOC → every section index
  log.md                    ← dated change history (newest first)
  forms/        index.md  dfa-ts-12.md  student-profile.md  …
  documents/    index.md  ic3-study-guide.md  …
  certifications/ index.md  ic3.md  mos.md  …
  platforms/    index.md  gmetrix-and-learnkey.md  …
```

### 5.3 Node schema — OKF's one rule (`type`) + routing extensions

```yaml
---
type: form                         # REQUIRED (OKF). form|program_document|certification|platform
title: Student Profile Form
description: Intake form capturing student contact + demographic details.
resource: forms/Student-Profile.pdf
tags: [onboarding, intake, required]
timestamp: 2026-06-30
vq_id: student-profile             # stable slug = filename (join key)
vq_audience: BOTH                  # existing ProgramDocAudience enum
vq_category: ORIENTATION           # existing ProgramDocCategory enum
vq_certification: ic3              # optional → certifications/ic3.md
vq_platform: gmetrix-and-learnkey  # optional → platforms/…
vq_storage_key: forms/Student-Profile.pdf
vq_status: draft                   # draft|approved — gates DB sync
---
## When to use
## When NOT to use      ← explicit contrast with confusable siblings (the retrieval fix)
## Related              ← enrolls in [IC3](../certifications/ic3.md), via [GMetrix](../platforms/…)
```

**Field-ownership split (anti-drift heart of the design):**
- **Hard identity** (`type, title, resource, vq_id, vq_audience, vq_category, vq_certification, vq_platform, vq_storage_key`) → *derived & validated* from `forms.ts` + DB. Generator owns these.
- **Soft routing** (`description, tags`, body `When to use / NOT / Related`) → *agent-drafted, human-curated*. Catalog owns these.
- Validator forbids any field being authored in two places.

### 5.4 Components (small, independently testable)

1. **Generator** — reads `src/lib/spokes/forms.ts` + `ProgramDocument` rows + cert/platform taxonomy → emits/updates node skeletons. **Idempotent: re-running refreshes hard identity but never clobbers curated bodies/soft fields.** New nodes default to `vq_status: draft`.
2. **Drafting pass** (one-time, agent-run) — reads each source doc *and its sibling forms* and drafts `description`/`tags`/`When to use`/`When NOT to use`. Output stays `draft`.
3. **Validator** (the `okf-validate` equivalent, wired into the existing `npx eslint .` / CI gate) — fails on: missing `type`, hard-field drift vs. source, broken cross-links, parity violations (orphan node or uncatalogued org file), or a node sourced from a student/PII path.
4. **Sync** — for `vq_status: approved` nodes only, writes curated routing metadata into the **DB-backed stores runtime already reads**: `ProgramDocument.sageContextNote` (+ proposed new `whenToUse`/`tags` columns) for documents, and a generated `config/form-routing.generated.json` overlay (mirrors the existing `config/sage-overrides.json` pattern) loaded by `form-search.ts` at module init. **Dry-run manifest first → human approves → apply.**

*(No per-request file IO is added; runtime retrieval plumbing is untouched in this slice.)*

### 5.5 Data flow

```
forms.ts + ProgramDocument/docs-upload + cert/platform taxonomy
   │ generate (hard fields)        + agent drafts (soft fields)
   ▼
catalog/**.md ───────────────────────────────► dev agent navigates (index.md TOC)
   │ human review:  draft → approved
   ▼
validate  (CI gate: type / parity / links / no-drift / no-PII)
   │ sync (dry-run manifest → approve → apply)
   ▼
ProgramDocument.sageContextNote/whenToUse/tags  +  form-routing overlay
   └──────────────────────────► Sage runtime retrieval (DB-backed, unchanged)
```

### 5.6 Anti-drift & governance guarantees

- **One source of truth per field-class** (hard = registry/DB, soft = catalog); validator enforces it.
- **No PII, ever**: org knowledge only; generator refuses student-sourced files; reuse `containsPII()` on drafted notes pre-commit, abort on hit.
- **Reviewable artifact before any mutation**: nothing reaches the DB until `approved` *and* the sync dry-run manifest is approved.
- **Reuses, doesn't replace**: extends the existing ingest/overrides patterns; deletes nothing.
- **Reconciliation bonus**: a form that exists in *both* `forms.ts` and as an ingested `ProgramDocument` PDF gets **one** catalog node linking both — untangling existing duplication.

### 5.7 Testing (TDD)

Validator tests first (it's the safety net): missing `type`, drift, broken link, orphan/uncatalogued, PII hit. Then generator idempotency + hard-field derivation; sync dry-run correctness + approved-only + idempotency; a generate→validate→approve→sync round-trip integration test; stand up the 20-item retrieval eval baseline.

### 5.8 Out of scope (YAGNI / deferred)

`viz.html` visualizer · the actual `sage_hybrid_search` SQL change to *use* the metadata (Sub-project B) · codebase/docs TOC (Sub-project C) · student-profile nodes (FERPA — never) · any new runtime file IO.

---

## 6. Open decision points (we'd value your opinion)

1. **Catalog location** — `catalog/` at repo root (proposed) vs. `okf/` (matches the fork's convention).
2. **Sync target** — add `whenToUse`/`tags` columns to `ProgramDocument` + a generated form-routing JSON overlay (proposed), **vs.** a dedicated `CatalogEntry` overlay table that *both* retrieval paths (documents and forms) join against. The latter is more uniform but adds a table/migration.
3. **Eval baseline timing** — stand up the 20-item retrieval eval set now in Sub-project A (proposed), vs. defer it entirely to Sub-project B.

---

## 7. Known pitfalls we are explicitly trying to avoid

- **Duplication/drift** between the catalog and `forms.ts`/DB (addressed by the hard/soft field-ownership split + validator).
- **FERPA violation** from putting student data in files (addressed by org-knowledge-only scope + PII guard).
- **Dead-artifact rot** — a generated catalog nobody maintains (addressed by giving it a real ongoing job: it's the authoring home for routing notes that sync to the DB).
- **Brittle retrieval tuning** — RRF parameters in `hybrid-retrieval.ts` were tuned against only ~20 queries; we want a bigger eval set before trusting changes.
- **Scope creep** into the codebase/dev-agent or the SQL change before the spine exists.

---

## 8. Specific questions for you (Codex)

1. **Does Sub-project A deliver value on its own, or is it inert until B?** Our claim: improving `sageContextNote` quality *does* help today (the current search ranks on `title + sageContextNote`), so A improves retrieval immediately; but `cert/platform` metadata stays unused until B. Is that reasoning sound? Would you re-sequence (e.g., do the small SQL/audience-ordering fix in B *first* because it's higher ROI per hour)?
2. **Is the hard/soft field-ownership split actually drift-proof?** Where could the generator + validator still let the catalog and the registry/DB diverge in practice?
3. **Sync target:** which of the two options in §6.2 would you choose, and why? Are we underestimating the cost of new `ProgramDocument` columns + a JSON overlay vs. a unified `CatalogEntry` table?
4. **Forms vs. documents are two pipelines.** Should Sub-project A try to *unify* them behind the catalog now, or is keeping them separate (and just feeding both) the right call for a first slice?
5. **FERPA reasoning** — is "org-knowledge-only catalog + generator refuses student paths + PII scan on drafts" sufficient, or is there a leakage path we're missing (e.g., a doc in `docs-upload/` that contains student examples)?
6. **Simpler alternative?** Is there a materially simpler design that achieves "agent finds the right file without reading the whole tree" + "Sage stops picking the wrong form" without introducing a markdown catalog at all (e.g., just better DB metadata + a generated `index.md`)? If so, make the case.
7. **What did we miss?** Failure modes, operational burden, or — per the owner's explicit ask — **additional responsibilities Sage could safely take on** that this catalog would enable (e.g., proactively surfacing the next required form, flagging missing orientation docs, teacher-facing "show me the applicable form" answers).
8. **Eval design** — what should the 20-item retrieval eval set contain to be a trustworthy baseline rather than a vanity metric?

Please be specific and cite the section/file you're critiquing. Disagreement is the point.

---

*End of review request.*
