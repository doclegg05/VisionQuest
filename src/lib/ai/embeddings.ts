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
import { aiAdmissionController, type AiCallPriority } from "./harness";
import { estimateTokens } from "@/lib/llm-usage-estimate";
import { logger } from "@/lib/logger";

export { EMBEDDING_DIMENSIONS };

export interface EmbeddingUsageContext {
  /** Null for system calls (ingest/backfill) — LlmCallLog.studentId is nullable. */
  studentId?: string | null;
  /** e.g. "sage_embedding_query", "sage_embedding_backfill". */
  callSite: string;
  /** Retrieval queries are interactive; indexing/extraction is background. */
  priority?: AiCallPriority;
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
  const priority =
    usage?.priority ??
    (taskType === "RETRIEVAL_QUERY" ? "foreground" : "background");
  const startedAt = Date.now();
  const lease = await aiAdmissionController.acquire(priority);
  const estimatedInputTokens = texts.reduce(
    (total, text) => total + estimateTokens(text.length),
    0,
  );
  try {
    const vectors = await provider.embed(texts, {
      taskType,
      callSite: usage?.callSite,
      studentId: usage?.studentId ?? null,
    });
    const durationMs = Date.now() - startedAt;
    logger.info("ai.harness.telemetry", {
      provider: provider.name,
      callSite: usage?.callSite ?? "sage_embedding",
      operation: "embedding",
      priority,
      status: "completed",
      durationMs,
      queueWaitMs: lease.queueWaitMs,
      ttftMs: durationMs,
      retryCount: 0,
      promptBudget: {
        maxInputTokens: 0,
        estimatedInputTokens,
        systemTokens: 0,
        messageTokens: estimatedInputTokens,
        currentMessageTokens: 0,
        droppedMessages: 0,
        duplicateCurrentMessagesRemoved: 0,
        overBudget: false,
      },
    });
    return vectors;
  } catch (error) {
    logger.warn("ai.harness.telemetry", {
      provider: provider.name,
      callSite: usage?.callSite ?? "sage_embedding",
      operation: "embedding",
      priority,
      status: "failed",
      durationMs: Date.now() - startedAt,
      queueWaitMs: lease.queueWaitMs,
      ttftMs: null,
      retryCount: 0,
      promptBudget: {
        maxInputTokens: 0,
        estimatedInputTokens,
        systemTokens: 0,
        messageTokens: estimatedInputTokens,
        currentMessageTokens: 0,
        droppedMessages: 0,
        duplicateCurrentMessagesRemoved: 0,
        overBudget: false,
      },
    });
    throw error;
  } finally {
    lease.release();
  }
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
