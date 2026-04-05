// src/lib/rag/embedding-provider.ts

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { EmbeddingProvider } from "./types";
import { logger } from "@/lib/logger";

const MODEL_NAME = "text-embedding-004";
const DIMENSIONS = 768;
const MAX_TOKENS_PER_BATCH = 8000;
const INITIAL_MAX_BATCH_SIZE = 32;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = DIMENSIONS;
  readonly name = MODEL_NAME;
  readonly version = "v1";

  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey.trim()) {
      throw new Error("GeminiEmbeddingProvider: apiKey must not be empty");
    }
    this.apiKey = apiKey;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const batches = buildAdaptiveBatches(texts, INITIAL_MAX_BATCH_SIZE);
    const results: number[][] = [];

    for (const batch of batches) {
      const embeddings = await this.embedBatch(batch);
      results.push(...embeddings);
    }

    return results;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    const requests = texts.map((text) => ({
      content: { role: "user" as const, parts: [{ text }] },
    }));

    try {
      const response = await model.batchEmbedContents({ requests });
      return response.embeddings.map((e) => e.values);
    } catch (error: unknown) {
      if (texts.length <= 1) {
        throw error;
      }

      logger.warn("Embedding batch failed, splitting and retrying", {
        batchSize: texts.length,
        error: error instanceof Error ? error.message : String(error),
      });

      const mid = Math.ceil(texts.length / 2);
      const left = texts.slice(0, mid);
      const right = texts.slice(mid);

      const [leftResults, rightResults] = await Promise.all([
        this.embedBatch(left),
        this.embedBatch(right),
      ]);

      return [...leftResults, ...rightResults];
    }
  }
}

function buildAdaptiveBatches(
  texts: string[],
  maxBatchSize: number,
): string[][] {
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentTokens = 0;

  for (const text of texts) {
    const tokens = estimateTokens(text);

    if (
      currentBatch.length > 0 &&
      (currentTokens + tokens > MAX_TOKENS_PER_BATCH ||
        currentBatch.length >= maxBatchSize)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(text);
    currentTokens += tokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const apiKey =
    process.env.GEMINI_EMBEDDING_API_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "Embedding provider requires GEMINI_API_KEY or GEMINI_EMBEDDING_API_KEY environment variable",
    );
  }

  return new GeminiEmbeddingProvider(apiKey);
}
