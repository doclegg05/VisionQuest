/**
 * Gemini embedding client for semantic RAG (Phase 1).
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

export const EMBEDDING_DIMENSIONS = 768;
export const EMBEDDING_MODEL = "gemini-embedding-001";

const BATCH_LIMIT = 100;
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface EmbeddingUsageContext {
  /** Null for system calls (ingest/backfill) — LlmCallLog.studentId is nullable. */
  studentId?: string | null;
  /** e.g. "sage_embedding_query", "sage_embedding_backfill". */
  callSite: string;
}

type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

interface EmbedTextsOptions {
  taskType: EmbeddingTaskType;
  usage?: EmbeddingUsageContext;
}

interface BatchEmbedResponse {
  embeddings?: Array<{ values?: number[] }>;
}

function requireApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for embedding generation");
  }
  return apiKey;
}

function estimateTokens(texts: string[]): number {
  return texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
}

function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) return vector;
  return vector.map((x) => x / norm);
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

async function callBatchEmbed(
  apiKey: string,
  texts: string[],
  taskType: EmbeddingTaskType,
): Promise<number[][]> {
  const response = await fetch(
    `${API_BASE}/models/${EMBEDDING_MODEL}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${EMBEDDING_MODEL}`,
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

/**
 * Embed a list of texts. Batches ≤100 per API request, retries each batch up
 * to 3 times with exponential backoff (429/5xx/network), L2-normalizes, and
 * asserts 768 dims. Returns vectors in input order.
 */
export async function embedTexts(
  texts: string[],
  { taskType, usage }: EmbedTextsOptions,
): Promise<number[][]> {
  if (texts.length === 0) {
    throw new Error("embedTexts requires at least one text");
  }
  if (texts.some((text) => text.trim().length === 0)) {
    throw new Error("embedTexts received an empty text");
  }
  const apiKey = requireApiKey();

  const results: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += BATCH_LIMIT) {
    const batch = texts.slice(offset, offset + BATCH_LIMIT);
    const startedAt = Date.now();

    const vectors = await retryWithBackoff(
      () => callBatchEmbed(apiKey, batch, taskType),
      {
        label: "Gemini embedding",
        alertKey: "embedding_request_exhausted",
        context: { taskType, batchSize: batch.length },
      },
    );

    const estimatedTokens = estimateTokens(batch);
    await logLlmCall({
      studentId: usage?.studentId ?? null,
      callSite: usage?.callSite ?? "sage_embedding",
      model: EMBEDDING_MODEL,
      inputTokens: estimatedTokens,
      outputTokens: 0,
      totalTokens: estimatedTokens,
      durationMs: Date.now() - startedAt,
    });

    results.push(...vectors);
  }

  return results;
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
