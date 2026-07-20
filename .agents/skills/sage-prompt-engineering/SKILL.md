# Sage Prompt Engineering Skill

Automatically invoked when modifying Sage AI behavior, system prompts, or chat logic.

## Model & Providers
- Default model: `gemini-3.1-flash-lite` — `DEFAULT_GEMINI_MODEL` in `src/lib/gemini.ts` (constants-only file), overridable via the `GEMINI_MODEL` env var
- All inference goes through the provider abstraction in `src/lib/ai/`:
  - `AIProvider` interface (`src/lib/ai/types.ts`): `generateResponse`, `streamResponse`, `generateStructuredResponse`, optional `streamWithTools`
  - `GeminiProvider` (cloud) and `OllamaProvider` (local) implementations
  - `resolveAiProvider()` in `src/lib/ai/provider.ts` routes by `DataSensitivity`: `student_record` and `staff_entered` prompts are FERPA-sensitive and go to the local Ollama provider when `ai_provider = "local"` is configured (operator may flip to cloud during alpha; every request is recorded in the AI audit log)
  - `getPromptTier()` returns `"compact"` for Ollama, `"full"` for cloud — compact prompts use `COMPACT_PERSONALITY` / `COMPACT_STAGE_PROMPTS`

## System Prompt Assembly
- `buildSystemPrompt()` in `src/lib/sage/system-prompts.ts` joins labeled sections (surface, safety, state.*, semantic.*, episodic.*, procedural) per stage and tier
- Personality and guardrails live in `src/lib/sage/personality.ts` (`BASE_PERSONALITY`, `GUARDRAILS`, `COMPACT_PERSONALITY`)
- `systemInstruction` is set at the `getGenerativeModel()` level in `src/lib/ai/gemini-provider.ts` — CRITICAL: never at chat-session level (breaks SSE streaming)
- Untrusted text (names, goals, discovery summaries, staff snippets) is bracketed and run through `sanitizeForPrompt()` to strip forged delimiters
- Chat endpoint: `POST /api/chat/send` → SSE stream

## Crisis Handling (988)
- Crisis resource is **988** (Suicide & Crisis Lifeline) — mandated by `GUARDRAILS`, and enforced deterministically even if the model forgets:
  - `detectCrisisSignal()` in `src/lib/sage/crisis-detection.ts` — regex phrase detector, no AI call, runs every turn
  - `ensureCrisisResources()` in `src/lib/chat/crisis-safety-net.ts` appends the 988 resource block when the incoming message matches and the reply lacks "988"
  - `recordWellbeingConcern()` raises a CRITICAL `StudentAlert` and notifies staff — NO message text is ever stored on the alert (privacy)

## Two-Call Pattern & Goal Proposals
- Call 1 streams the chat reply; call 2 is `handlePostResponse()` in `src/lib/chat/post-response.ts` — async, fire-and-forget: goal extraction, discovery signals, mood extraction, memory extraction, classroom confirmation, title generation
- Extracted goals are PROPOSED, never auto-confirmed: `proposeGoal()` in `src/lib/sage/propose-goal.ts` creates Goal rows with `status: "proposed"`; a human confirms
- Idempotent on `(studentId, sourceMessageId, level)` — the same Sage turn never proposes two goals at the same level; levels are `bhag | monthly | weekly | daily | task` (`src/lib/goals.ts`)
- Progression/XP stays locked until a proposal is confirmed

## RAG (built and live)
- `getDocumentContext()` in `src/lib/sage/knowledge-base-server.ts` assembles document context under a 6,000-char budget (`TOKEN_BUDGET_CHARS`)
- Hybrid retrieval (`src/lib/sage/hybrid-retrieval.ts`): `visionquest.sage_hybrid_search()` fuses pgvector cosine similarity with Postgres full-text search via reciprocal rank fusion (k=50); returns null on any failure so chat never goes down with it
- Kill switches: `SAGE_RAG_ENABLED=false` disables document context; `SAGE_RAG_MODE=keyword` falls back to legacy keyword scoring (also the automatic fallback path)
- Ingestion: `syncSageDocuments()` in `src/lib/sage/ingest.ts` — non-PII program documents only; a `containsPII()` guard skips any file that looks like it contains student PII
- Curated org-knowledge catalog lives under `catalog/`; the `catalog-drift` CI job (`npm run catalog:drift`) audits catalog vs. live `ProgramDocument` rows

## Testing & Evals
- `.github/workflows/sage-evals.yml` runs on PRs touching `src/lib/sage/**`, `config/sage-*.json`, or `scripts/sage-*.mjs` (plus nightly):
  - GATING: red-team eval (`npm run sage:redteam:eval`, config `config/sage-redteam-eval.json`) and the chat harness deterministic families (`scripts/sage-chat-harness.mjs --strict --families=tool,guardrail --temperature=0`)
  - Informational: quality, tool-selection, and memory evals
- Keep the gating evals green when changing Sage prompts, tools, or eval configs — eval fixtures assert on verbatim prompt substrings, so update `config/sage-redteam-eval.json` leak markers when prompt wording changes
- Test edge cases: vague goals ("I want a better life"), crisis language (verify 988 appears), off-topic redirects, and that goal extraction doesn't hallucinate goals from casual conversation
