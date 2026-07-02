/**
 * Shared token-count estimator. Used as a fallback wherever a provider
 * doesn't report real usage metadata (older Ollama builds, non-JSON
 * error paths, etc.) — same char/4 approximation previously duplicated
 * across src/lib/llm-usage.ts, src/lib/ai/embeddings.ts, and the
 * post-response extractors.
 */
export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}
