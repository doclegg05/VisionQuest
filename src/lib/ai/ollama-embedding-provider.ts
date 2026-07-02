/**
 * Local (Ollama-compatible) embedding provider (Phase 3: local embeddings
 * capability). Same EmbeddingProvider contract as GeminiEmbeddingProvider so
 * callers (document-embedding, hybrid-retrieval, memory) are provider-agnostic.
 *
 * Default model is "nomic-embed-text" — natively 768-dim, matching the fixed
 * pgvector column width. "embeddinggemma" also works (768-dim). 1024-dim
 * models like mxbai-embed-large or bge-m3 are REJECTED by the hard dimension
 * assertion below — we never truncate a vector to fit, since truncating an
 * embedding silently corrupts its semantic geometry (unlike Matryoshka-trained
 * models such as gemini-embedding-001, arbitrary embedding models are not
 * safe to slice).
 *
 * Tries Ollama's native /api/embed endpoint first (POST { model, input }).
 * On 404 (server doesn't expose the native route), falls back to the
 * OpenAI-compatible /v1/embeddings endpoint (reads response.data[].embedding).
 */

import { retryWithBackoff } from "@/lib/sage/retry";
import { logLlmCall } from "@/lib/llm-usage";
import { buildLocalAiHeaders } from "./local-auth";
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider, type EmbeddingTaskType } from "./embedding-types";
import type { LocalAIAuthConfig } from "./types";

export const DEFAULT_LOCAL_EMBEDDING_MODEL = "nomic-embed-text";

const BATCH_LIMIT = 96;

interface NativeEmbedResponse {
  embeddings?: number[][];
}

interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

function estimateTokens(texts: string[]): number {
  return texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
}

function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) return vector;
  return vector.map((x) => x / norm);
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = "ollama";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly authConfig: LocalAIAuthConfig | null;
  private useNative = true;

  constructor(
    baseUrl: string,
    model: string,
    authConfig?: LocalAIAuthConfig | null,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.authConfig = authConfig ?? null;
  }

  private get headers(): Record<string, string> {
    return buildLocalAiHeaders(this.authConfig, {
      "Content-Type": "application/json",
    });
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
        () => this.embedBatch(batch),
        {
          label: "Local embedding",
          alertKey: "local_embedding_request_exhausted",
          context: { taskType: opts.taskType, batchSize: batch.length, model: this.model },
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

  private async embedBatch(texts: string[]): Promise<number[][]> {
    if (this.useNative) {
      const nativeResult = await this.callNativeEmbed(texts);
      if (nativeResult === "not-found") {
        this.useNative = false;
      } else {
        return this.assertDimensions(nativeResult.map(l2Normalize));
      }
    }

    const openAiResult = await this.callOpenAiEmbed(texts);
    return this.assertDimensions(openAiResult.map(l2Normalize));
  }

  private async callNativeEmbed(
    texts: string[],
  ): Promise<number[][] | "not-found"> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (response.status === 404) {
      return "not-found";
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Local embedding request failed (${response.status}) ${body.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as NativeEmbedResponse;
    const embeddings = payload.embeddings ?? [];
    if (embeddings.length !== texts.length) {
      throw new Error(
        `Local embedding response count mismatch: sent ${texts.length}, got ${embeddings.length}`,
      );
    }
    return embeddings;
  }

  private async callOpenAiEmbed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Local embedding request failed (${response.status}) ${body.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as OpenAIEmbeddingResponse;
    const data = payload.data ?? [];
    if (data.length !== texts.length) {
      throw new Error(
        `Local embedding response count mismatch: sent ${texts.length}, got ${data.length}`,
      );
    }
    return data.map((entry, index) => {
      const values = entry.embedding ?? [];
      if (values.length === 0) {
        throw new Error(`Local embedding ${index} returned no vector`);
      }
      return values;
    });
  }

  /** Hard-assert every vector is exactly EMBEDDING_DIMENSIONS long — never truncate. */
  private assertDimensions(vectors: number[][]): number[][] {
    vectors.forEach((vector, index) => {
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Local embedding model "${this.model}" returned ${vector.length} dims for item ${index}, expected ${EMBEDDING_DIMENSIONS}. ` +
            `Use a native ${EMBEDDING_DIMENSIONS}-dim model (e.g. nomic-embed-text, embeddinggemma) — ` +
            `1024-dim models (mxbai-embed-large, bge-m3) are not supported and must not be truncated.`,
        );
      }
    });
    return vectors;
  }
}
