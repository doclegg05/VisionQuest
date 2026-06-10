# Phase 2 — Sage Memory System Implementation Plan

> Executed inline (orchestrator session) after two background-agent attempts produced
> nothing. Scope contract: Phase 2 section of
> `2026-06-09-chat-first-rebuild-master-plan.md`. Patterns reused from Phase 1:
> embeddings client, pgvector migration style (HNSW + RLS), raw-SQL vector writes,
> env-tunable retrieval knobs.

**Goal:** Sage durably remembers facts about each student (and program-level facts),
retrieves them into every conversation, and gives teachers FERPA-compliant
inspect/correct/delete control.

## Tasks

- [ ] **T1 Schema + migration** — `SageMemory` (subject-scoped facts with `embedding
  vector(768)`, kind episodic|semantic|procedural, confidence, validFrom/validTo,
  sourceType/sourceId/sourceHash), `SageMemoryEdge` (typed predicates w/ evidence),
  `SageOperation` (ledger, pulled in for Phase 3). HNSW index on embedding; partial
  unique index on (subjectType, subjectId, sourceHash) WHERE validTo IS NULL for
  dedupe; RLS: read admin/teacher all + student own rows; write admin/teacher all +
  student INSERT own only. Cron uses `prismaAdmin` (RLS-exempt).
- [ ] **T2 Validation gate** — `src/lib/sage/memory/schema.ts`: zod controlled vocab
  (subjectType, kind, category list, predicate), confidence 0–1, content 1–500 chars;
  `sourceHashFor()` sha256 over normalized subject+content. Tests.
- [ ] **T3 Extraction** — `src/lib/sage/memory/extract.ts`: `extractMemories()` takes the
  conversation turns, calls the SAME provider resolution as chat (FERPA: student_record →
  local-only policy unchanged; cloud allowed only when policy says so), prompts for
  JSON candidates (ADD-only, no mutations), validates via T2, dedupes by sourceHash
  against existing rows, embeds accepted memories (embedTexts), inserts content +
  vector (raw SQL pattern from document-embedding.ts). Failure-isolated: never throws
  to caller. Tests with mocked provider/db/embeddings.
- [ ] **T4 Retrieval** — `src/lib/sage/memory/retrieve.ts`: subject-scoped cosine search
  (raw SQL, HNSW) over active memories (validTo IS NULL), recency+confidence boost,
  char-budgeted formatted block wrapped with sanitizeForPrompt. Tests.
- [ ] **T5 Wiring** — `handlePostResponse()` gains fire-and-forget memory extraction
  (same pattern as goal extraction; SAGE_MEMORY_ENABLED env gate, default on);
  `buildSystemPrompt()` injects the retrieved memory block for student stages.
- [ ] **T6 Consolidation cron** — `POST /api/internal/memory/consolidate` (Bearer
  CRON_SECRET, prismaAdmin): archive duplicates beyond the unique index (defensive),
  decay episodic confidence (×0.95/week past 30 days), archive (validTo=now)
  memories with confidence < 0.2.
- [ ] **T7 Teacher inspector** — API `GET/PATCH/DELETE /api/teacher/students/[id]/memories`
  (teacher/admin role-gated, AuditLog on correct/delete) + `MemoryInspectorPanel` in
  the student detail Progress tab.
- [ ] **T8 Eval** — `scripts/sage-memory-eval.mjs`: replays 20 synthetic scripted
  conversations through extract→retrieve; reports duplicate-fact rate (<5% gate) and
  retrieval hit rate for "what do you know about me?" facts.
- [ ] **T9 Gates + PR** — npm test / eslint / typecheck / build green; migration applied
  to dev DB; PR with eval numbers.

**Acceptance (master plan):** accurate "what do you know about me?"; duplicate-fact
rate <5% over the 20-conversation eval; memory writes never block the SSE stream
(fire-and-forget, verified by wiring test).
