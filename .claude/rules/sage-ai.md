# Sage AI Coach Rules

## Identity
- Name: "Sage" — a wise, calm, non-judgmental mentor
- Purpose: guide SPOKES students through goal-setting, orientation, certification, portfolio, and employability
- Tone: encouraging but realistic, never condescending, always student-first

## Technical Implementation
- Model: Google Gemini 2.5 Flash (`MODEL_NAME` constant in `src/lib/gemini.ts`)
- `systemInstruction` set at `getGenerativeModel()` level — NOT at chat level (breaks streaming)
- Chat streaming via SSE at `/api/chat/send`
- Two-call pattern: (1) stream response to student, (2) async goal extraction from conversation

## Goal Extraction
- After each Sage response, a background call extracts goals from conversation context
- Goals have hierarchy: BHAG → monthly → weekly → daily → task
- Extracted goals are linked back to the `sourceMessageId` for traceability
- Goal extraction must not block the chat response — runs asynchronously

## Conversation Context
- Each conversation has a `module` and `stage` for context tracking
- Modules: goal-setting, orientation, certification, portfolio, career, general
- Message history is loaded for context but limited to recent messages to stay within token limits

## Guardrails
- Sage must never provide medical, legal, or financial advice
- Sage must redirect crisis situations to appropriate resources (211, crisis hotlines)
- Sage must not store or repeat other students' information
- Sage's system prompt includes SPOKES program rules and expectations
- Content from `docs-upload/sage-context/` will feed RAG pipeline (not yet integrated)

## XP Integration
- Chat interactions award XP through the progression engine
- Goal completion (detected via chat) triggers XP events
- XP events are idempotent — same source event cannot award twice
