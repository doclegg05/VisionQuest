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
 *
 * The resolver requires a sensitivity; this facade supplies one when the
 * caller does not, in the fail-closed direction:
 *  - `embedTexts` with a known student → `student_record`; with no student
 *    and nothing declared → `system` (document ingest, backfills).
 *  - `embedQuery` → `student_record` unless told otherwise: a retrieval
 *    query is someone's message, never system data, even when the caller
 *    has no student id to hand.
 */

import { resolveEmbeddingProvider } from "./embedding-provider";
import { EMBEDDING_DIMENSIONS, type EmbeddingTaskType } from "./embedding-types";
import type { DataSensitivity } from "./types";

export { EMBEDDING_DIMENSIONS };

export interface EmbeddingUsageContext {
  /** Null for system calls (ingest/backfill) — LlmCallLog.studentId is nullable. */
  studentId?: string | null;
  /** e.g. "sage_embedding_query", "sage_embedding_backfill". */
  callSite: string;
  /**
   * What the texts carry (src/lib/ai/types.ts DataSensitivity). Declare it
   * at every call site that knows; the inference above is only the floor.
   */
  sensitivity?: DataSensitivity;
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

function inferSensitivity(usage: EmbeddingUsageContext | undefined): DataSensitivity {
  if (usage?.sensitivity) return usage.sensitivity;
  return usage?.studentId ? "student_record" : "system";
}

/**
 * Embed a list of texts using the currently configured embedding provider
 * (Gemini or local Ollama, per SystemConfig `ai_provider`). Returns vectors
 * in input order. Throws `AiCloudRefusedError` when `ai_cloud_policy`
 * refuses the declared sensitivity on the cloud provider.
 */
export async function embedTexts(
  texts: string[],
  options: EmbedTextsOptions,
): Promise<number[][]> {
  return (await embedTextsWithModel(texts, options)).vectors;
}

/** Keep vectors and their producing model together even if config changes in flight. */
export async function embedTextsWithModel(
  texts: string[],
  { taskType, usage }: EmbedTextsOptions,
): Promise<{ vectors: number[][]; model: string }> {
  const studentId = usage?.studentId ?? null;
  const provider = await resolveEmbeddingProvider({
    studentId,
    callSite: usage?.callSite,
    sensitivity: inferSensitivity(usage),
  });
  const vectors = await provider.embed(texts, {
    taskType,
    callSite: usage?.callSite,
    studentId,
  });
  return { vectors, model: provider.model };
}

/** Embed a single retrieval query. */
export async function embedQuery(
  text: string,
  usage?: EmbeddingUsageContext,
): Promise<number[]> {
  const [vector] = await embedTexts([text], {
    taskType: "RETRIEVAL_QUERY",
    usage: {
      callSite: "sage_embedding_query",
      ...usage,
      sensitivity: usage?.sensitivity ?? "student_record",
    },
  });
  return vector;
}
