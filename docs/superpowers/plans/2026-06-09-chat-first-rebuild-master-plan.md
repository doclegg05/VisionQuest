# VisionQuest Chat-First Rebuild — Master Implementation Plan

> **For agentic workers:** This is the MASTER plan. Each phase below gets its own detailed
> task-level plan (written at phase start, saved as
> `docs/superpowers/plans/2026-06-XX-phase-N-<name>.md`) executed via
> superpowers:subagent-driven-development with TDD and atomic commits. Phases use checkbox
> (`- [ ]`) syntax for tracking. Do not start phase N+1 until phase N's acceptance criteria
> pass and the phase branch is merged to main.

**Goal:** Transform VisionQuest into a chat-first platform where Sage — upgraded to Gemini 3.1
Flash Lite with semantic RAG and durable memory — acts as a total site manager: accepting and
filing documents through chat, managing orientation/forms, and connecting the resume builder,
job search, and credential system into one workflow.

**Architecture:** Extend the existing Sage agent framework (`src/lib/sage/agent/`) from 5
read-only tools to a full read/write tool registry with confirmation UX; replace keyword RAG
with hybrid semantic search (pgvector + tsvector + RRF); add a native memory layer
(TEKTON-inspired, Mem0-patterned) in Prisma; rebuild the student home around a persistent
Sage conversation with ambient panels. Supabase Storage stays the document source of truth;
Gemini Files API is an ephemeral processing window gated by recorded consent.

**Tech Stack:** Next.js 15 + Prisma + Supabase Postgres (pgvector), Gemini 3.1 Flash Lite
(`gemini-3.1-flash-lite`) + `gemini-embedding-001` @ 768 dims, existing Ollama local provider
as fallback, jsPDF/`@react-pdf/renderer` for resume, Playwright e2e.

**Locked decisions (user-approved 2026-06-09):**
1. Model: jump directly to Gemini 3.1 Flash Lite; validate with the RAG/agent eval harness.
2. Student files: cloud Gemini Files API processing allowed **with recorded consent**
   (new `ConsentRecord` model; provider routing honors consent; no consent → local model or
   deterministic parsing).
3. In-flight bot branches merge first (Phase 0).
4. UX: **bold chat-first redesign** — Sage conversation is the student home screen; pages
   become destinations Sage navigates to.

**Key OSS patterns to borrow (all MIT/Apache — cite in code comments where ported):**
- Reactive Resume v5 (MIT): resume JSON-Patch propose→accept/reject editing pattern.
- Supabase hybrid search: tsvector + pgvector + reciprocal rank fusion RPC.
- Mem0: user/agent/session memory scoping; async post-stream memory writes.
- Graphiti: `validFrom`/`validTo` temporal validity on memory facts.
- TEKTON (`~/dev/active/TEKTON/docs/specs/2026-06-05-aios-v2-graph-memory-design.md`):
  typed memory edges with evidence + confidence; source-hash drift detection; operation ledger.

---

## Phase 0 — Land in-flight work + model upgrade

**Branch:** work directly via PRs from existing branches; model change on `feat/gemini-3-1-upgrade`.

- [x] Merge `origin/feat/resume-live-preview` via PR (verified conflict-free; tests included).
- [x] Finish `origin/feat/wv-local-job-feed`:
  - [x] Generate + apply Prisma migration for `JobListing.employmentType`.
  - [x] Complete student filter UI in `src/components/jobs/JobFilters.tsx`
        (keyword, min pay, employment type, posted-after — API already accepts these params).
  - [x] End-to-end test: filters → `/api/jobs` → filtered list.
  - [x] Merge via PR.
- [x] Model upgrade: default `gemini-3.1-flash-lite` in `src/lib/ai/gemini-provider.ts`
      (env-overridable via `GEMINI_MODEL`); verify model-level `systemInstruction` still applies
      (per CLAUDE.md gotcha); run `npm run sage:rag:harness` + chat smoke tests; re-check token
      quota math in `src/lib/llm-usage.ts` against 3.1 pricing ($0.25/$1.50 per M).
- [x] Remove orphaned `/jobs` redirect page.

**Acceptance:** both branches merged; harness pass-rate unchanged or better on 3.1;
`npm run build` + full test suite green.

## Phase 1 — Semantic RAG core

**Branch:** `feat/semantic-rag`

**Files (primary):** `prisma/schema.prisma` + migration (pgvector extension, `embedding vector(768)`
on `ProgramDocument`, new `DocumentChunk` model), new `src/lib/ai/embeddings.ts`
(gemini-embedding-001, 768 dims), new `prisma/migrations/.../hybrid_search.sql` (RRF function),
`src/lib/sage/ingest.ts` (embed on ingest), `src/lib/sage/knowledge-base-server.ts` (replace
keyword scoring with hybrid retrieval; keep keyword fallback when embeddings absent),
`scripts/backfill-embeddings.mjs`, `scripts/sage-rag-harness.mjs` (add clean-retrieval gate).

- [x] Enable pgvector; add embedding columns + `DocumentChunk` (chunk size 512 tokens, 50 overlap).
- [x] Embedding service with batching + retry + `LlmCallLog` cost logging.
- [x] Hybrid search SQL function: `tsvector` GIN + HNSW index, RRF k=50, weights configurable.
- [x] Ingest pipeline embeds `sageContextNote` + chunks; backfill all ~150 ProgramDocuments.
- [x] Retrieval swap in `getDocumentContext()`; audience filtering preserved.
- [x] Harness: keep 100% top-3 relevance; **clean retrieval ≥ 80%** (now 25%); add 20 new
      fixture questions covering forms + LMS guides.

**Acceptance:** harness thresholds met; retrieval latency < 300ms p95 locally; no FERPA
regression (embeddings of program docs only — student content not embedded until Phase 2).

## Phase 2 — Sage memory system

**Branch:** `feat/sage-memory`

**Schema (new Prisma models, all `@@schema("visionquest")`):**
- `SageMemory { id, subjectType (student|teacher|class|program), subjectId, kind (episodic|semantic|procedural), content, embedding vector(768), category, confidence, validFrom, validTo?, sourceType, sourceId, sourceHash, createdAt, updatedAt }`
- `SageMemoryEdge { id, fromId, toId, predicate (depends_on|blocks|supersedes|relates_to|evidenced_by), evidence, confidence, createdAt }`
- `SageOperation { id (deterministic op-{timestamp}-{slug}), actorType, actorId, toolName, status, payload Json, resultSummary, createdAt }` — the operation ledger; every agent write tool records here.

**Files:** `src/lib/sage/memory/` (new module: `extract.ts`, `retrieve.ts`, `consolidate.ts`,
`schema.ts` with zod validation gate), `src/lib/chat/post-response.ts` (async memory extraction
after stream — Mem0 pattern), `src/lib/sage/system-prompts.ts` (inject retrieved memories),
`src/app/api/internal/memory/consolidate/route.ts` (weekly cron: dedupe by sourceHash, decay
confidence, archive expired), teacher-visible memory inspector in student detail Progress tab.

- [ ] Models + migration; validation gate (controlled vocab, required fields) before any write.
- [ ] Extraction: post-response LLM pass produces candidate memories (ADD-only accumulation);
      provider routing per FERPA policy + consent.
- [ ] Retrieval: hybrid search over memories scoped by subject; merged into `buildSystemPrompt`.
- [ ] Consolidation cron + decay; source-hash drift check against Postgres rows (TEKTON pattern).
- [ ] Memory inspector UI (teacher can view/correct/delete a student's memories — FERPA right).

**Acceptance:** Sage answers "what do you know about me?" accurately from memory; duplicate-fact
rate < 5% on a 20-conversation test script; memory writes never block the SSE stream.

## Phase 3 — Agentic Sage: write tools + files through chat

**Branch:** `feat/sage-actions`

**Consent first:** `ConsentRecord { id, studentId, scope (cloud_file_processing), grantedAt, revokedAt?, recordedBy }` + consent step in orientation wizard + settings toggle;
`resolveAiProvider()` consults consent for file-processing tasks.

**File pipeline (chat upload):** Composer attachment → `POST /api/chat/upload` → Supabase
Storage (source of truth) → if consent: Gemini Files API URI for native PDF understanding,
else local model/deterministic parse → Sage classifies via `file_document` tool → routes to
`FileUpload` (student docs), `CertRequirement.fileId` (evidence), or form-submission record →
tool card in chat confirms filing location; `SageOperation` ledger entry + `AuditLog`.

**New write tools (in `src/lib/sage/agent/tools.ts`, each role-gated, each with a
confirm-before-execute card except trivially reversible ones):**
`file_document`, `submit_form` (signed orientation/DOHS forms → form status updated, teacher
notified), `update_goal_status`, `mark_requirement_complete` (proposes; teacher still verifies),
`update_profile_field`, `save_job`, `book_appointment`, `add_portfolio_item`.

- [ ] Consent model + orientation/settings UI + provider routing.
- [ ] Chat attachments end-to-end (UI composer → storage → classification → filing card).
- [ ] Write tools with zod-validated params, confirmation UX, ledger + audit on every execution.
- [ ] Orientation-via-chat golden path: instructor/student hands Sage a signed form →
      classified → linked to orientation item → status flips → appears on teacher dashboard.
- [ ] `SAGE_AGENT_ENABLED` default true; `maxHops` raised to 8; agent eval set
      (`config/sage-agent-eval.json`, ≥25 scripted tool-use scenarios) added to harness.

**Acceptance:** golden path passes e2e; every write tool execution has a ledger + audit row;
prompt-injection test suite (malicious file names/content attempting tool abuse) passes;
no tool executes outside the actor's role permissions.

## Phase 4 — Chat-first dashboard redesign

**Branch:** `feat/chat-first-home`

- [ ] New student home: persistent Sage conversation as the primary surface with ambient
      panels (readiness w/ "what's next" breakdown, today's tasks, alerts, overdue forms) —
      panels are driven by the same data as today's dashboard widgets; Sage `navigate` actions
      (already in `AgentToolResult.action`) deep-link to pages.
- [ ] Replace single-exchange `SageMiniChat` with a persistent multi-turn dock sharing
      conversation state with `/chat` (one conversation source of truth).
- [ ] Nav consolidation: Resources → Learning tab section; Files → "Documents" (Sage-managed
      view of FileUpload + filed items); Orientation re-accessible post-completion (read-only
      archive); resume gets a Home entry point; tool-result cards (document preview, form
      status, job match) rendered inline in chat.
- [ ] Teacher: Sage chat gains intervention-queue summarization tool with *reasons*
      ("flagged for: stale goals 14d, missed appointment 6/2"); queue UI shows same reasons.
- [ ] Old dashboard preserved at `/dashboard/classic` for one release (fallback + comparison).

**Acceptance:** new-student e2e (register → welcome → chat-first home → set BHAG via Sage →
sign form via chat) passes; mobile bottom-nav still functional at 375px; Lighthouse
accessibility ≥ 90 on home; existing dashboards' data parity verified.

## Phase 5 — Career trio connected through Sage

**Branch:** `feat/career-connected`

- [ ] Resume: JSON-Patch propose→accept/reject flow for Sage edits (Reactive Resume pattern) —
      new `propose_resume_edit` tool; student reviews diff card; accepted patches applied to
      `ResumeData`.
- [ ] Jobs: `analyze_job_match` tool — Sage reads a posting + student profile/resume/certs →
      skill-gap summary + "resources to close gap" (links Learning items); job search via chat
      ("find me CNA jobs near Beckley").
- [ ] Credentials: Sage suggests evidence→`CertRequirement` matches when documents are filed
      (teacher verification unchanged); server-side Credly badge caching
      (`src/app/api/credly/badges` gains DB cache w/ 24h TTL).
- [ ] Goal → resume → job thread: confirming a career goal prompts Sage to flag resume gaps
      and relevant job matches.

**Acceptance:** each flow has an e2e test; resume edits never apply without explicit accept;
job analysis cites only real posting content (no hallucinated requirements — eval-checked).

## Phase 6 — Hardening, evals, deploy

**Branch:** `chore/launch-hardening`

- [ ] Security review of all new write tools + upload pipeline + consent enforcement
      (treat as auth-adjacent: injection, path traversal, MIME spoofing, role bypass).
- [ ] Full eval pass: RAG harness, agent eval set, memory accuracy script; quota/pricing
      re-tune for 3.1 Flash Lite.
- [ ] E2e suite green (Playwright); 80% coverage on new modules.
- [ ] Render deploy: migrations via `prisma migrate deploy` (auto on deploy), env vars
      (GEMINI_MODEL, COS_USER_ID/COS_API_TOKEN for CareerOneStop, embedding config) —
      mind Render gotchas: devDependencies, standalone mode, env var formatting.
- [ ] Docs: update CLAUDE.md, DEPLOY.md, README; project `.claude/MEMORY.md` session log.

**Acceptance:** production deploy healthy; smoke tests on prod; rollback plan documented.

---

## Execution protocol (loop operations)

1. Per phase: write detailed task plan → execute via subagents (TDD, atomic commits) →
   code review (code-reviewer + security-reviewer for tool/upload/consent code) → fix →
   PR → merge → update this file's checkboxes + `.claude/MEMORY.md`.
2. Orchestrator (main session) reviews between phases and surfaces anything needing
   user input; otherwise proceeds autonomously.
3. Eval gates are hard: a phase does not merge if its acceptance criteria fail.
4. FERPA invariant (never violated by any phase): student-record content reaches cloud
   models only with a `ConsentRecord`; every Sage write action is audited.
