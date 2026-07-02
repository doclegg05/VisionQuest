/**
 * Provider-neutral embedding types (Phase 3: local embeddings capability).
 *
 * Mirrors the AIProvider/types.ts split for chat: a shared shape both the
 * cloud (Gemini) and local (Ollama) embedding implementations satisfy, so
 * callers (document-embedding, hybrid-retrieval, memory) depend on the
 * interface, not a specific vendor.
 */

/** Fixed pgvector column width — every provider must return vectors this long. */
export const EMBEDDING_DIMENSIONS = 768;

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;

  /**
   * Embed a batch of texts, returning L2-normalized vectors in input order.
   * Every implementation must assert `EMBEDDING_DIMENSIONS`-length output.
   *
   * `studentId` is optional and used only for LlmCallLog attribution (daily
   * token-quota accounting) — it does not affect API-key resolution, which
   * happens once when the provider is constructed via resolveEmbeddingProvider.
   */
  embed(
    texts: string[],
    opts: { taskType: EmbeddingTaskType; callSite?: string; studentId?: string | null },
  ): Promise<number[][]>;
}
