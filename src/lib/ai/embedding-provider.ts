/**
 * Resolve the active embedding provider based on SystemConfig `ai_provider`
 * (Phase 3: local embeddings capability).
 *
 * FERPA FREEZE: routing keys ONLY off the existing `ai_provider` value
 * ("local" | "cloud"), exactly like getConfiguredProviderType() in
 * src/lib/ai/provider.ts. No sensitivity parameters, no new routing logic.
 *
 * - "local" -> OllamaEmbeddingProvider (reads ai_provider_url, ai_provider_embedding_model)
 * - "cloud" or unset -> GeminiEmbeddingProvider (uses existing API key resolution)
 */

import { getPlainConfigValue } from "@/lib/system-config";
import { resolveApiKey } from "@/lib/chat/api-key";
import { isSafeAiProviderUrl } from "@/lib/validation";
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  readLocalAiProviderConfig,
  toLocalAiAuthConfig,
} from "./local-config";
import { GeminiEmbeddingProvider } from "./gemini-embedding-provider";
import { OllamaEmbeddingProvider } from "./ollama-embedding-provider";
import type { EmbeddingProvider } from "./embedding-types";

async function getConfiguredProviderType(): Promise<"local" | "cloud"> {
  const providerType = await getPlainConfigValue("ai_provider");
  return providerType === "local" ? "local" : "cloud";
}

async function getLocalEmbeddingProvider(): Promise<EmbeddingProvider> {
  const config = await readLocalAiProviderConfig();
  if (!config.url) {
    throw new Error(
      "Local AI server URL is not configured. Set it in Program Setup > AI Provider.",
    );
  }
  if (!isSafeAiProviderUrl(config.url)) {
    throw new Error(
      "Local AI server URL is invalid. Use localhost/127.0.0.1/::1 or a public http/https endpoint.",
    );
  }
  return new OllamaEmbeddingProvider(
    config.url,
    config.embeddingModel ?? DEFAULT_LOCAL_EMBEDDING_MODEL,
    toLocalAiAuthConfig(config),
  );
}

async function getCloudEmbeddingProvider(
  studentId: string | null,
): Promise<EmbeddingProvider> {
  const apiKey = await resolveApiKey(studentId ?? "");
  return new GeminiEmbeddingProvider(apiKey);
}

/**
 * Resolve the embedding provider for the currently configured `ai_provider`.
 * `studentId` is only used for cloud API-key resolution (personal key
 * override); system/backfill calls should omit it or pass null.
 */
export async function resolveEmbeddingProvider(opts?: {
  studentId?: string | null;
  callSite?: string;
}): Promise<EmbeddingProvider> {
  const providerType = await getConfiguredProviderType();
  return providerType === "local"
    ? getLocalEmbeddingProvider()
    : getCloudEmbeddingProvider(opts?.studentId ?? null);
}

/**
 * Returns the model string the resolver would use, without constructing a
 * full provider (no API key resolution, no network round-trip). Kept in
 * sync with resolveEmbeddingProvider — INVARIANT: for any given
 * SystemConfig state, `(await resolveEmbeddingProvider()).model ===
 * (await getActiveEmbeddingModel())`.
 */
export async function getActiveEmbeddingModel(): Promise<string> {
  const providerType = await getConfiguredProviderType();
  if (providerType === "local") {
    const config = await readLocalAiProviderConfig();
    return config.embeddingModel ?? DEFAULT_LOCAL_EMBEDDING_MODEL;
  }
  return new GeminiEmbeddingProvider("").model;
}
