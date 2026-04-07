# Sage Prompt Engineering Skill

Automatically invoked when modifying Sage AI behavior, system prompts, or chat logic.

## Architecture
- Model: Gemini 2.5 Flash via `@google/generative-ai`
- System instruction: set at `getGenerativeModel()` level in `src/lib/gemini.ts`
- CRITICAL: never set systemInstruction at chat session level — it breaks SSE streaming
- Chat endpoint: `POST /api/chat/send` → SSE stream
- Two-call pattern: (1) stream chat response, (2) async goal extraction

## System Prompt Guidelines
- Sage is a workforce development coach for adults on TANF/SNAP
- Tone: warm, encouraging, non-judgmental, professional
- Must include: SPOKES program rules, student's current goals, orientation status
- Must exclude: medical/legal/financial advice, other students' data
- Context window: limit message history to recent N messages (token budget)

## Goal Extraction Prompt
- Runs after each chat response (async, non-blocking)
- Input: recent conversation messages
- Output: structured JSON with goal hierarchy (BHAG → monthly → weekly → daily → task)
- Must include `sourceMessageId` for traceability
- Idempotent: same conversation state should not create duplicate goals

## Testing Prompts
- Test with edge cases: vague goals ("I want a better life"), crisis language, off-topic requests
- Verify Sage redirects crisis situations to resources (211 hotline, local services)
- Verify goal extraction doesn't hallucinate goals from casual conversation
- Verify XP awards trigger correctly on goal completion detection

## Future: RAG Pipeline
- `docs-upload/sage-context/` contains SPOKES reference materials
- When RAG is implemented: chunk documents, embed, store in Supabase pgvector
- Sage will retrieve relevant context before generating responses
- Keep system prompt under token limits even with RAG context injected
