/**
 * Gemini embedding provider for semantic RAG (Phase 1, refactored into the
 * EmbeddingProvider interface in Phase 3).
 *
 * REST calls to gemini-embedding-001 via batchEmbedContents (≤100 texts per
 * request), 768 output dimensions. Vectors below the model's native 3072 dims
 * are NOT pre-normalized by the API, so we L2-normalize client-side — cosine
 * distance in pgvector then behaves identically to inner-product ranking.
 *
 * Every API call is logged through logLlmCall(). The embeddings API returns
 * no usage metadata, so input tokens are estimated at ceil(chars / 4); output
 * tokens are 0 (embeddings have no completion).
 */

import { retryWithBackoff } from "@/lib/sage/retry";
import { logLlmCall } from "@/lib/llm-usage";
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider, type EmbeddingTaskType } from "./embedding-types";

const BATCH_LIMIT = 100;
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface BatchEmbedResponse {
  embeddings?: Array<{ values?: number[] }>;
}

function estimateTokens(texts: string[]): number {
  return texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
}

function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) return vector;
  return vector.map((x) => x / norm);
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "gemini";
  readonly model = "gemini-embedding-001";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(
    texts: string[],
    opts: { taskType: EmbeddingTaskType; callSite?: string; studentId?: string | null },
  ): Promise<number[][]> {
    if (texts.length === 0) {
      throw new Error("embed requires at least one text");
    }
    if (texts.some((text) => text.trim().length === 0)) {
      throw new Error("embed received an empty text");
    }

    const results: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += BATCH_LIMIT) {
      const batch = texts.slice(offset, offset + BATCH_LIMIT);
      const startedAt = Date.now();

      const vectors = await retryWithBackoff(
        () => this.callBatchEmbed(batch, opts.taskType),
        {
          label: "Gemini embedding",
          alertKey: "embedding_request_exhausted",
          context: { taskType: opts.taskType, batchSize: batch.length },
        },
      );

      const estimatedTokens = estimateTokens(batch);
      await logLlmCall({
        studentId: opts.studentId ?? null,
        callSite: opts.callSite ?? "sage_embedding",
        model: this.model,
        inputTokens: estimatedTokens,
        outputTokens: 0,
        totalTokens: estimatedTokens,
        durationMs: Date.now() - startedAt,
      });

      results.push(...vectors);
    }

    return results;
  }

  private async callBatchEmbed(
    texts: string[],
    taskType: EmbeddingTaskType,
  ): Promise<number[][]> {
    const response = await fetch(
      `${API_BASE}/models/${this.model}:batchEmbedContents`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${this.model}`,
            content: { parts: [{ text }] },
            taskType,
            outputDimensionality: EMBEDDING_DIMENSIONS,
          })),
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Embedding request failed: ${response.status} ${body.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as BatchEmbedResponse;
    const embeddings = payload.embeddings ?? [];
    if (embeddings.length !== texts.length) {
      throw new Error(
        `Embedding response count mismatch: sent ${texts.length}, got ${embeddings.length}`,
      );
    }

    return embeddings.map((entry, index) => {
      const values = entry.values ?? [];
      if (values.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Embedding ${index} has ${values.length} dims, expected ${EMBEDDING_DIMENSIONS}`,
        );
      }
      return l2Normalize(values);
    });
  }
}
