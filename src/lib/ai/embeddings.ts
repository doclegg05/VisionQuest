/**
 * Embedding facade for semantic RAG (Phase 1; provider-abstracted in Phase 3).
 *
 * Thin wrapper around resolveEmbeddingProvider() — delegates the actual
 * REST/batch/normalize/retry/logging work to whichever EmbeddingProvider is
 * configured (GeminiEmbeddingProvider or OllamaEmbeddingProvider). Kept as a
 * separate module (rather than having every consumer call
 * resolveEmbeddingProvider directly) so existing call sites
 * (document-embedding, hybrid-retrieval, memory/*, form-search) compile
 * unchanged.
 */

import { resolveEmbeddingProvider } from "./embedding-provider";
import { EMBEDDING_DIMENSIONS, type EmbeddingTaskType } from "./embedding-types";

export { EMBEDDING_DIMENSIONS };

export interface EmbeddingUsageContext {
  /** Null for system calls (ingest/backfill) — LlmCallLog.studentId is nullable. */
  studentId?: string | null;
  /** e.g. "sage_embedding_query", "sage_embedding_backfill". */
  callSite: string;
}

interface EmbedTextsOptions {
  taskType: EmbeddingTaskType;
  usage?: EmbeddingUsageContext;
}

/** Format a vector as a pgvector literal, e.g. "[0.1,0.2,...]". */
export function toVectorLiteral(vector: number[]): string {
  for (const component of vector) {
    if (!Number.isFinite(component)) {
      throw new Error("Vector components must be finite numbers");
    }
  }
  return `[${vector.join(",")}]`;
}

/**
 * Embed a list of texts using the currently configured embedding provider
 * (Gemini or local Ollama, per SystemConfig `ai_provider`). Returns vectors
 * in input order.
 */
export async function embedTexts(
  texts: string[],
  { taskType, usage }: EmbedTextsOptions,
): Promise<number[][]> {
  const provider = await resolveEmbeddingProvider({
    studentId: usage?.studentId ?? null,
    callSite: usage?.callSite,
  });
  return provider.embed(texts, {
    taskType,
    callSite: usage?.callSite,
    studentId: usage?.studentId ?? null,
  });
}

/** Embed a single retrieval query. */
export async function embedQuery(
  text: string,
  usage?: EmbeddingUsageContext,
): Promise<number[]> {
  const [vector] = await embedTexts([text], {
    taskType: "RETRIEVAL_QUERY",
    usage: usage ?? { callSite: "sage_embedding_query" },
  });
  return vector;
}
