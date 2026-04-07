# Local AI Provider Integration — Design Spec

**Date:** 2026-04-07
**Status:** Draft
**Author:** Claude + User
**Branch:** feat/local-ai-provider

## Purpose

Add support for local LLM inference via Ollama alongside the existing Gemini API, enabling Sage AI testing with different models (Gemma 4, Phi-4, Qwen, etc.) without API costs. The system allows switching between providers and models via environment variables.

## Scope

- **In scope:** Provider abstraction layer, Ollama integration, env-based model swapping, mock provider for CI
- **Out of scope:** Production deployment of local models, eval harness, UI-based model switching, context window management changes
- **Known limitation:** Gemma 4 8B has an 8K context window vs Gemini's 1M. Long Sage conversations may exceed local model limits. This will need addressing if local models are used beyond testing.

## Architecture

### Provider Abstraction Layer

New directory `src/lib/ai/` with four files:

```
src/lib/ai/
  types.ts       — Shared interface and message types
  provider.ts    — Factory function that returns the configured provider
  gemini.ts      — Wraps existing Google Gemini SDK calls
  ollama.ts      — OpenAI-compatible client for Ollama
```

### Provider Interface (`types.ts`)

```typescript
export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface AIProvider {
  readonly modelName: string;
  generateResponse(systemPrompt: string, messages: ChatMessage[]): Promise<string>;
  streamResponse(systemPrompt: string, messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string>;
  generateStructuredResponse(systemPrompt: string, messages: ChatMessage[]): Promise<string>;
}
```

**Interface contract:** `messages` must contain at least one entry with `role: "user"`. Providers should throw if the array is empty.

### Factory Function (`provider.ts`)

```typescript
// Ollama singleton — no per-student state, reuse across requests
let ollamaInstance: OllamaProvider | null = null;

export function getProvider(apiKey?: string): AIProvider {
  const provider = process.env.AI_PROVIDER || "gemini";

  switch (provider) {
    case "ollama":
      if (!ollamaInstance) ollamaInstance = new OllamaProvider();
      return ollamaInstance;
    case "mock":
      return new MockProvider();
    case "gemini":
    default:
      return new GeminiProvider(apiKey!);
  }
}
```

The `apiKey` parameter is required for Gemini (per-student encrypted keys) but ignored by Ollama and Mock providers. Gemini creates a new instance per request because `apiKey` varies per student. Ollama uses a module-level singleton since it has no per-request state, and this avoids redundant health checks.

### Gemini Provider (`gemini.ts`)

Wraps the existing `@google/generative-ai` SDK logic currently in `src/lib/gemini.ts`. No behavioral changes — same `systemInstruction` at model level, same streaming, same JSON response mode.

**Chat history pattern:** The Gemini SDK uses `startChat({ history })` + `sendMessage(lastMessage)`. The provider splits the flat `ChatMessage[]` into `history[0..n-1]` and sends `messages[n-1]` via `sendMessage`/`sendMessageStream`, preserving current behavior.

**Note:** The existing `getModel()` function is internal to the Gemini provider and is not exposed on the `AIProvider` interface. It was never consumed externally.

### Ollama Provider (`ollama.ts`)

Uses `fetch()` against Ollama's OpenAI-compatible API (`/v1/chat/completions`). Key translation details:

| Gemini concept | Ollama equivalent |
|---|---|
| `systemInstruction` at model level | `{ role: "system" }` message prepended to array |
| Message role `"model"` | Mapped to `"assistant"` |
| `responseMimeType: "application/json"` | `response_format: { type: "json_object" }` |
| SDK streaming via async iterator | SSE parsing of `data:` lines with `delta.content` |

**Structured output handling:** Smaller models produce malformed JSON more frequently than Gemini. The Ollama provider wraps `generateStructuredResponse` with a retry loop (up to 2 retries) that catches `JSON.parse` failures and re-requests.

**Health check:** The Ollama singleton caches health check results with a 60-second TTL. On the first request (or after TTL expiry), it calls `GET /api/tags` to verify:
1. Ollama is running (fail fast with clear error if connection refused)
2. The requested model is pulled (clear message: "Run `ollama pull <model>` first")

**AbortSignal support:** `streamResponse` accepts an optional `AbortSignal` and passes it to `fetch()`. When a student navigates away mid-stream, the SSE connection drops and the abort signal cancels the Ollama request, freeing CPU. Without this, CPU inference continues for 45-70s even after the client disconnects.

### Mock Provider (for CI)

Returns canned responses instantly. Used when `AI_PROVIDER=mock`:
- `generateResponse` → returns a static coaching response
- `streamResponse` → yields the same response in chunks
- `generateStructuredResponse` → returns valid JSON matching expected schemas

This unblocks smoke tests and CI without any AI backend.

## Migration Strategy

**Phase 1 — Thin re-export (no consumer changes):**

Rewrite `src/lib/gemini.ts` to delegate to the factory:

```typescript
import { getProvider } from "./ai/provider";

export async function generateResponse(apiKey: string, systemPrompt: string, messages: ChatMessage[]) {
  return getProvider(apiKey).generateResponse(systemPrompt, messages);
}

export async function* streamResponse(apiKey: string, systemPrompt: string, messages: ChatMessage[]) {
  yield* getProvider(apiKey).streamResponse(systemPrompt, messages);
}

export async function generateStructuredResponse(apiKey: string, systemPrompt: string, messages: ChatMessage[]) {
  return getProvider(apiKey).generateStructuredResponse(systemPrompt, messages);
}

// Keep for api-key validation route (Gemini-specific)
export { GEMINI_MODEL, DEFAULT_GEMINI_MODEL } from "./ai/gemini";
```

This means **zero changes to the 6 consumer files** in Phase 1. The existing import paths continue to work.

**Phase 2 (optional, later):** Migrate consumers to import directly from `@/lib/ai/provider` and remove the re-export shim.

## Environment Variables

```bash
# Provider selection (default: gemini — no change needed for existing behavior)
AI_PROVIDER=gemini           # or "ollama" or "mock"

# Gemini config (existing, unchanged)
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash-lite

# Ollama config (only read when AI_PROVIDER=ollama)
OLLAMA_BASE_URL=http://localhost:11434   # default if unset
OLLAMA_MODEL=gemma4:latest               # whatever is pulled locally
OLLAMA_TIMEOUT=300000                    # ms, default 300s for structured responses
```

## Performance Expectations

Tested on user's hardware (Intel i5-13500T, 32GB RAM, Intel UHD 770):

| Metric | Gemini API | Gemma 4 8B (Q4_K_M, CPU) |
|---|---|---|
| Time to first token | <1 second | 5-15 seconds |
| Token speed | ~80+ tok/s | ~10 tok/s |
| 200-token response | 2-5 seconds | 45-70 seconds |
| Cost | API credits | Free |
| Data privacy | Cloud | Fully local |

## Concurrency

CPU inference is single-threaded per request. Concurrent Ollama requests queue and degrade performance. The existing rate limiter (`60 requests per 60 minutes`) is sufficient — CPU speed naturally throttles throughput. No additional concurrency limiting needed for dev/testing use.

## Error Handling

| Scenario | Behavior |
|---|---|
| Ollama not running | Fail fast: "Ollama is not running. Start it or set AI_PROVIDER=gemini" |
| Model not pulled | Fail fast: "Model 'X' not found. Run `ollama pull X`" |
| Malformed JSON (structured) | Retry up to 2 times, then degrade gracefully (skip extraction, log warning) |
| Goal extraction fails repeatedly | Log warning, skip extraction — never surface AI errors to the student |
| Timeout (streaming) | 120s default; Ollama uses `OLLAMA_TIMEOUT` env var (default 300s for `generateStructuredResponse`) |
| No API key (Gemini mode) | Existing behavior preserved — "Sage is not configured" message |

## Testing

- Existing smoke tests (`scripts/run-smoke-public-routes.mjs`) continue working with `AI_PROVIDER=mock`
- Manual testing: switch to `AI_PROVIDER=ollama`, chat with Sage, evaluate response quality and speed
- `npx eslint .` and `npx prisma validate` before committing

## Model Swapping Workflow

To test a different model:

```bash
# Pull the new model
ollama pull phi4

# Update .env.local
OLLAMA_MODEL=phi4

# Restart dev server, chat with Sage
npm run dev
```

Models confirmed compatible with this hardware:
- `gemma4:latest` (8B, 9.6GB) — installed, tested
- `phi4` (14B, ~8GB file, ~12GB runtime with KV cache) — good structured output, tight on 32GB RAM
- `qwen2.5:7b` (~4.5GB) — fast, strong reasoning
- `gemma3:4b` (~2.5GB) — fastest option

## Files Changed

| File | Change |
|---|---|
| `src/lib/ai/types.ts` | New — provider interface and types |
| `src/lib/ai/provider.ts` | New — factory function |
| `src/lib/ai/gemini.ts` | New — Gemini provider class (logic moved from `src/lib/gemini.ts`) |
| `src/lib/ai/ollama.ts` | New — Ollama provider class |
| `src/lib/ai/mock.ts` | New — mock provider for CI |
| `src/lib/gemini.ts` | Modified — thin re-export shim delegating to factory |
| `.env.example` | Modified — add AI_PROVIDER, OLLAMA_BASE_URL, OLLAMA_MODEL |

No changes to any consumer files (chat route, extractors, summarizer, resume-ai).
