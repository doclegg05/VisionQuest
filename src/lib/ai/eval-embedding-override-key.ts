/**
 * Where the eval harness puts an eval-only embedding provider for
 * `--provider=openrouter` runs on synthetic data
 * (scripts/lib/sage-eval-provider.mjs, installOpenRouterEvalEmbeddings).
 * Only resolveEmbeddingProvider and getActiveEmbeddingModel read it, and they
 * refuse it inside the app server. Nothing under src/ may write it, except
 * the boot lock below: src/lib/ai/embedding-provider.eval-override.test.ts
 * fails if anything else does.
 */
export const EVAL_EMBEDDING_OVERRIDE_KEY = Symbol.for("visionquest.evalEmbeddingProvider");

/**
 * Called at server boot (src/instrumentation.ts): empties the override slot
 * and makes it read-only for the life of the process, so an install there
 * fails instead of succeeding quietly. Safe to call more than once.
 */
export function lockEvalEmbeddingOverride(): void {
  Object.defineProperty(globalThis, EVAL_EMBEDDING_OVERRIDE_KEY, {
    value: undefined,
    writable: false,
    configurable: false,
    enumerable: false,
  });
}
