---
paths:
  - "src/lib/sage/**"
  - "src/lib/ai/**"
  - "src/lib/chat/**"
  - "src/app/api/chat/**"
  - "config/sage-*.json"
  - "scripts/sage-*"
---
# Sage AI Coach Rules

## Identity
- Name: "Sage" — a wise, calm, non-judgmental mentor
- Purpose: guide SPOKES students through goal-setting, orientation, certification, portfolio, and employability
- Tone: encouraging but realistic, never condescending, always student-first

## Technical Implementation
- Model: Google Gemini 3.1 Flash Lite (`DEFAULT_GEMINI_MODEL` in `src/lib/gemini.ts`, `GEMINI_MODEL` env override)
- Provider abstraction in `src/lib/ai/`: `GeminiProvider` (cloud) + `OllamaProvider` (local). `resolveAiProvider` routes on two settings: `ai_provider` picks the configured provider (`local` serves everything locally; `cloud`/unset serves everything from Gemini), and `ai_cloud_policy` (SystemConfig, env fallback `AI_CLOUD_POLICY`; `src/lib/ai/lanes.ts`) decides whether a cloud resolution is allowed for the task's lane and sensitivity — `permissive` (DEFAULT, production today: `student_record`/`staff_entered` prompts DO reach Gemini when `ai_provider` is cloud or unset), `lanes` (the `batch`/`emotional` lanes refuse the cloud), `local_only` (every `student_record`/`staff_entered` prompt refuses the cloud). A refusal writes a `blocked` AI audit event and throws `AiCloudRefusedError`; callers fail closed (503 + 988 block in chat), never fall through. Personal Gemini keys never serve a local-only sensitivity. Embeddings (`resolveEmbeddingProvider`) and uploaded document bytes (`describeDocument`) go through the same resolver rules; `getPromptTier` selects the compact prompt for local models
- **De-identification at the provider boundary**: when the resolver returns a CLOUD provider for a `student_record` or `staff_entered` call, it wraps it in `withDeidentification` (`src/lib/ai/with-deidentification.ts`) around a per-request `TokenVault` (`src/lib/ai/deidentify.ts`) populated by `loadIdentityInput` (`src/lib/ai/identity.ts`, app client only — never `prismaAdmin`). Outbound, the student's display name / first name / email / login id / phone, staff and roster names, and any email, phone, DOB or street address in free text become loud `[STUDENT_NAME]`-style tokens; inbound, only tokens that same vault issued are restored, including across streamed chunks, so the saved transcript matches what the student saw. It lives in the resolver so a call site cannot forget it. Kill switch `ai_deidentify_cloud` / `AI_DEIDENTIFY_CLOUD` — `"off"` disables, anything else including unset is ON; it can never refuse a turn, and a failed identity lookup degrades to an unwrapped call rather than an error. Values in `src/lib/ai/deidentify-allowlist.ts` (988 and the other crisis lines) are never tokenized. Memory content is pseudonymised at WRITE time in `src/lib/sage/memory/store.ts` and that substitution is permanent — there is no vault at read time. **It is not de-identification**: third-party names ("my son Jayden") and document bytes are not covered, and a small cohort is re-identifiable with no name present. Say "reduced disclosure of identifiers under a data-processing agreement", never "de-identified". Full contract, limits and operator SQL: `docs/runbooks/ai-deidentification.md`
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
- Crisis handling is deterministic, not model-dependent: `src/lib/sage/crisis-detection.ts` (English + Spanish phrase patterns) + `src/lib/chat/crisis-safety-net.ts` append the 988 resource block if the model reply lacks it, and raise a CRITICAL StudentAlert with a structured context card (category only — never message text) routed to the student's assigned instructors (all-teacher fallback). The appended block is **localized by the language of the matched pattern** (`lang` on each `CrisisPattern`; Spanish match → `CRISIS_RESOURCE_BLOCK_ES` with the 988 "oprime 2" / text-AYUDA access paths) — never by inferring language from free text. Both blocks must keep the literal `988` (reply-dedupe marker) and `instructor` (redteam `mustMention`). Detection is recall-first: every new pattern needs its false-positive guards in the same change, every guard needs a proof that it BITES (the unguarded shape of the pattern shown matching the phrase the guard silences, beside a positive control that still alerts — a guard that could never fire certifies nothing), and an English means/method pattern wants a Spanish counterpart, or an explicit note saying why not. The `crisis-en` benchmark (`config/benchmarks/crisis-en.json`, corpus in `config/benchmarks/fixtures/`) runs at **gate** tier as of B1b — a change that drops English must-detect recall below 0.98, or pushes either false-positive rate past its floor, fails the PR; `crisis-es` meets the same numbers but stays at `watch` until a native speaker reviews its corpus, which is an owner step, not an engineering one
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
