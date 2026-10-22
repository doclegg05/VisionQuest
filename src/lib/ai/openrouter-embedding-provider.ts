import { assertCloudInferenceAllowed } from "./demo-local-only";
/**
 * Eval-only OpenRouter embedding provider: Google's gemini-embedding-001,
 * the model production embeds with, reached through OpenRouter.
 *
 * Synthetic eval data only. The memory and RAG evals embed through the app's
 * resolver, so the eval harness installs this provider as an eval-only
 * override (scripts/lib/sage-eval-provider.mjs); the app never constructs it.
 * ESLint forbids importing it from src/ (openrouter-import-guard.test.ts),
 * and it refuses to run inside the app server.
 *
 * Vectors match the app's 768-column store: the request asks for 768
 * dimensions, and a longer reply is truncated and L2-normalized, which is how
 * gemini-embedding-001's Matryoshka-trained vectors are meant to be shortened.
 * OpenRouter's embeddings API takes no task type, so a query and a document
 * embed the same way here, unlike production's Gemini calls.
 *
 * Runbook: docs/runbooks/openrouter-test-bench.md.
 */
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider, type EmbeddingTaskType } from "./embedding-types";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  OPENROUTER_DEFAULT_BASE,
  OPENROUTER_PRIVACY,
  OpenRouterError,
  RETRY_DELAYS_MS,
  assertNotAppServer,
  failureFromResponse,
  isRetryable,
  transportError,
} from "./openrouter-provider";

export const OPENROUTER_EMBEDDING_MODEL = "google/gemini-embedding-001";

const BATCH_LIMIT = 100;

export interface OpenRouterEmbeddingOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called with each batch's billed cost in USD, when OpenRouter reports one. */
  onCost?: (costUsd: number) => void;
}

/** First `dimensions` components, L2-normalized. Returns a new array. */
export function fitToDimensions(vector: readonly number[], dimensions: number = EMBEDDING_DIMENSIONS): number[] {
  if (vector.length < dimensions) {
    throw new Error(`Embedding has ${vector.length} dimensions, expected at least ${dimensions}`);
  }
  const kept = vector.slice(0, dimensions);
  if (!kept.every((component) => Number.isFinite(component))) {
    throw new Error("Embedding components must be finite numbers");
  }
  const norm = Math.sqrt(kept.reduce((sum, component) => sum + component * component, 0));
  return norm === 0 ? kept : kept.map((component) => component / norm);
}

interface EmbeddingReply {
  vectors: number[][];
  costUsd: number | null;
}

/** Boundary parse of OpenRouter's embeddings reply into vectors in input order. */
function parseEmbeddingReply(text: string, expected: number): EmbeddingReply {
  const broken = (detail: string) => new OpenRouterError(`OpenRouter returned a broken embeddings reply (${detail})`, "unavailable");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw broken("not JSON");
  }
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data) || data.length !== expected) throw broken(`expected ${expected} vectors`);
  const vectors: Array<number[] | null> = Array.from({ length: expected }, () => null);
  for (const [position, entry] of data.entries()) {
    const { embedding, index } = (entry ?? {}) as { embedding?: unknown; index?: unknown };
    const slot = index === undefined ? position : index;
    if (!Number.isInteger(slot) || typeof slot !== "number" || slot < 0 || slot >= expected || vectors[slot] !== null) {
      throw broken("bad or repeated index");
    }
    if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === "number")) {
      throw broken("malformed vector");
    }
    try {
      vectors[slot] = fitToDimensions(embedding);
    } catch (error) {
      throw broken(error instanceof Error ? error.message : "malformed vector");
    }
  }
  const complete = vectors.filter((entry): entry is number[] => entry !== null);
  if (complete.length !== expected) throw broken("missing vector");
  const cost = (json as { usage?: { cost?: unknown } }).usage?.cost;
  return { vectors: complete, costUsd: typeof cost === "number" ? cost : null };
}

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openrouter";
  readonly model: string;
  // A private field, so logging or serializing the provider never shows the key.
  readonly #apiKey: string;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onCost?: (costUsd: number) => void;

  constructor(apiKey: string, model: string = OPENROUTER_EMBEDDING_MODEL, options: OpenRouterEmbeddingOptions = {}) {
    assertNotAppServer();
    if (!apiKey) throw new OpenRouterError("OPENROUTER_API_KEY is not set", "bad_request");
    this.#apiKey = apiKey;
    this.model = model;
    this.url = `${(options.baseUrl ?? OPENROUTER_DEFAULT_BASE).replace(/\/+$/, "")}/v1/embeddings`;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onCost = options.onCost;
  }

  /** `taskType` is accepted for the interface; OpenRouter's embeddings API has no equivalent. */
  async embed(
    texts: string[],
    opts: { taskType: EmbeddingTaskType; callSite?: string; studentId?: string | null },
  ): Promise<number[][]> {
    assertCloudInferenceAllowed();
    void opts;
    if (texts.length === 0) throw new Error("embed requires at least one text");
    if (texts.some((text) => text.trim().length === 0)) throw new Error("embed received an empty text");
    const results: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += BATCH_LIMIT) {
      const batch = texts.slice(offset, offset + BATCH_LIMIT);
      const reply = await this.withRetries(() => this.embedBatch(batch));
      if (reply.costUsd !== null) this.onCost?.(reply.costUsd);
      results.push(...reply.vectors);
    }
    return results;
  }

  private async embedBatch(batch: string[]): Promise<EmbeddingReply> {
    assertCloudInferenceAllowed();
    const body = {
      model: this.model,
      input: batch,
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: "float",
      provider: OPENROUTER_PRIVACY,
    };
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw transportError(error, this.requestTimeoutMs);
    }
    if (!response.ok) throw await failureFromResponse(response);
    try {
      text = await response.text();
    } catch (error) {
      throw transportError(error, this.requestTimeoutMs);
    }
    return parseEmbeddingReply(text, batch.length);
  }

  private async withRetries<T>(attempt: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i += 1) {
      try {
        return await attempt();
      } catch (error) {
        if (!isRetryable(error) || i >= RETRY_DELAYS_MS.length) throw error;
        await this.sleep(RETRY_DELAYS_MS[i]);
      }
    }
  }
}
