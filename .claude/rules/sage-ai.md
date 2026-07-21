# Sage AI Coach Rules

## Identity
- Name: "Sage" — a wise, calm, non-judgmental mentor
- Purpose: guide SPOKES students through goal-setting, orientation, certification, portfolio, and employability
- Tone: encouraging but realistic, never condescending, always student-first

## Technical Implementation
- Model: Google Gemini 3.1 Flash Lite (`DEFAULT_GEMINI_MODEL` in `src/lib/gemini.ts`, `GEMINI_MODEL` env override)
- Provider abstraction in `src/lib/ai/`: `GeminiProvider` (cloud) + `OllamaProvider` (local). `resolveAiProvider` routes by data sensitivity — `student_record`/`staff_entered` are local-only by policy (FERPA); `getPromptTier` selects the compact prompt for local models
- `systemInstruction` set at `getGenerativeModel()` level in `src/lib/ai/gemini-provider.ts` — NOT at chat level (breaks streaming). Explicit `safetySettings` (BLOCK_ONLY_HIGH) so default filters can't block crisis-coaching replies
- Cloud chat turns retry transient failures (429/5xx/network) before the first streamed token only
- Chat streaming via SSE at `/api/chat/send` (heartbeats, disconnect handling)
- Two-call pattern: (1) stream response to student, (2) async `handlePostResponse` (`src/lib/chat/post-response.ts`) runs prioritized background extraction — mood/wellbeing always first and cap-exempt, then goals, discovery, classroom confirmation, memory (optional `SAGE_POST_RESPONSE_MAX_CALLS` cap)
- Prompt changes must bump `SAGE_PROMPT_REVISION` (`src/lib/sage/prompt-revision.ts`) — it stamps every LlmCallLog row and AI audit event for regression attribution

## Goal Extraction
- After each Sage response, a background call extracts goals from conversation context
- Goals have hierarchy: BHAG → monthly → weekly → daily → task
- Extracted goals are PROPOSED (`status: "proposed"` via `src/lib/sage/propose-goal.ts`), idempotent on (studentId, sourceMessageId, level) — students cannot self-confirm Sage-proposed goals; instructors confirm
- Extracted goals are linked back to the `sourceMessageId` for traceability
- Goal extraction must not block the chat response — runs asynchronously
- Exhausted extraction retries persist to the `FailedExtraction` dead-letter table for teacher review/replay — never silently dropped

## Conversation Context
- Each conversation has a `module` and `stage` for context tracking
- Modules: goal-setting, orientation, certification, portfolio, career, general
- Message history is loaded for context but limited to recent messages to stay within token limits

## Guardrails
- Sage must never provide medical, legal, or financial advice
- Crisis handling is deterministic, not model-dependent: `src/lib/sage/crisis-detection.ts` (English + Spanish phrase patterns) + `src/lib/chat/crisis-safety-net.ts` append the 988 resource block if the model reply lacks it, and raise a CRITICAL StudentAlert with a structured context card (category only — never message text) routed to the student's assigned instructors (all-teacher fallback)
- Sage must not store or repeat other students' information
- Sage's system prompt includes SPOKES program rules and expectations (`src/lib/sage/personality.ts`, assembled by `src/lib/sage/system-prompts.ts`)
- RAG is live: hybrid pgvector + full-text retrieval with reciprocal rank fusion (`src/lib/sage/hybrid-retrieval.ts`, assembled by `getDocumentContext` in `knowledge-base-server.ts`; `SAGE_RAG_ENABLED` / `SAGE_RAG_MODE=keyword` kill switches). Grounding docs are `ProgramDocument` rows curated via the teacher sage-context API plus the git-tracked `catalog/` OKF layer
- Any Sage behavior change must keep the gating CI evals green: red-team + chat harness in `.github/workflows/sage-evals.yml` (fixtures in `config/sage-*.json` assert verbatim prompt substrings and 988 handling)
- Prompt edits must keep the eval leak canaries fresh: every `neverContain` string in the eval fixtures must exist verbatim in the built prompt (`system-prompts.test.ts` "eval canary freshness" fails otherwise — move the fixtures in the same change). Canaries are distinctive meta-instruction fragments, never ordinary coaching vocabulary
- Gating tool cases vote across `--samples=3` draws in CI (Gemini tool selection is not deterministic at temperature=0). A tool case that still flaps gets demoted to family `tool_watch`, which runs informationally (WATCH lines + `::warning`, never gates) — never delete a flaky case or widen its `acceptableTools` to a non-equivalent tool

## XP Integration
- Chat interactions award XP through the progression engine
- Goal completion (detected via chat) triggers XP events
- XP events are idempotent — same source event cannot award twice
