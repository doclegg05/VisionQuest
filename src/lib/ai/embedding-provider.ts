/**
 * Resolve the active embedding provider based on SystemConfig `ai_provider`
 * (Phase 3: local embeddings capability), under the same cloud policy as
 * the generative resolver.
 *
 * Every embedding call declares a `sensitivity`. The raw chat message
 * (hybrid retrieval), every stored memory and every retrieval query are
 * `student_record` / `staff_entered`; document ingest and backfills are
 * `system`. A cloud resolution consults `ai_cloud_policy` for the
 * `embedding` task (lane `coaching`, so only `local_only` refuses it today)
 * and every resolution — local or cloud — writes an AI audit event, so the
 * accountability report and the `ferpa-routing` benchmark can see this path
 * at all. Until 2026-09 they could not: the FERPA review found the raw
 * student message reaching Gemini's embeddings API on every turn with no
 * sensitivity, no policy and no audit row.
 *
 * - "local" -> OllamaEmbeddingProvider (reads ai_provider_url, ai_provider_embedding_model)
 * - "cloud" or unset -> GeminiEmbeddingProvider (platform key; a student's
 *   personal key never serves a local-only sensitivity)
 */

import { getPlainConfigValue } from "@/lib/system-config";
import { resolveApiKey } from "@/lib/chat/api-key";
import { isSafeAiProviderUrl } from "@/lib/validation";
import {
  getProviderClass,
  logAiAuditEvent,
  policyDecisionForProvider,
} from "@/lib/ai/audit";
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  readLocalAiProviderConfig,
  toLocalAiAuthConfig,
} from "./local-config";
import {
  enforceCloudPolicy,
  isLocalOnlySensitivity,
  laneForTask,
  readAiCloudPolicy,
  type AiCloudPolicy,
} from "./lanes";
import { GeminiEmbeddingProvider } from "./gemini-embedding-provider";
import { OllamaEmbeddingProvider } from "./ollama-embedding-provider";
import type { EmbeddingProvider } from "./embedding-types";
import type { DataSensitivity } from "./types";

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
  sensitivity: DataSensitivity,
): Promise<EmbeddingProvider> {
  // Same rule as the generative resolver: a personal consumer key may serve
  // only content outside the FERPA rule (src/lib/chat/api-key.ts).
  const apiKey = await resolveApiKey(studentId ?? "", {
    allowPersonalKey: !isLocalOnlySensitivity(sensitivity),
  });
  return new GeminiEmbeddingProvider(apiKey);
}

export interface ResolveEmbeddingProviderOptions {
  /**
   * The student the texts are about. Used for cloud API-key resolution and
   * as the audit actor; null for system/backfill calls with no student.
   */
  studentId?: string | null;
  /** e.g. "sage_embedding_query", "sage_memory_extract" — recorded on the audit event. */
  callSite?: string;
  /** What the texts carry. Required: an undeclared embedding is the hole this closes. */
  sensitivity: DataSensitivity;
}

async function recordRouted(
  opts: ResolveEmbeddingProviderOptions,
  provider: EmbeddingProvider,
  policy: AiCloudPolicy,
): Promise<void> {
  const providerClass = getProviderClass(provider.name);
  await logAiAuditEvent({
    actorId: opts.studentId ?? null,
    actorRole: null,
    route: "ai.resolve",
    task: "embedding",
    sensitivity: opts.sensitivity,
    policyDecision: policyDecisionForProvider(provider.name),
    status: "routed",
    targetId: opts.studentId ?? null,
    providerName: provider.name,
    providerClass,
    allowCloud: providerClass === "cloud",
    metadata: { callSite: opts.callSite ?? null, lane: laneForTask("embedding"), policy },
  });
}

/**
 * Resolve the embedding provider for the configured `ai_provider`, applying
 * `ai_cloud_policy` to a cloud resolution and writing one AI audit event:
 * `routed` on success, `blocked` (then `AiCloudRefusedError`) on refusal.
 */
export async function resolveEmbeddingProvider(
  opts: ResolveEmbeddingProviderOptions,
): Promise<EmbeddingProvider> {
  const studentId = opts.studentId ?? null;
  const providerType = await getConfiguredProviderType();

  if (providerType === "local") {
    const provider = await getLocalEmbeddingProvider();
    await recordRouted(opts, provider, await readAiCloudPolicy());
    return provider;
  }

  // Throws AiCloudRefusedError (after the blocked audit event) when the
  // policy refuses this sensitivity on a cloud model.
  const policy = await enforceCloudPolicy({
    studentId,
    task: "embedding",
    sensitivity: opts.sensitivity,
  });
  const provider = await getCloudEmbeddingProvider(studentId, opts.sensitivity);
  await recordRouted(opts, provider, policy);
  return provider;
}

/**
 * Returns the model string the resolver would use, without constructing a
 * full provider (no API key resolution, no network round-trip, no audit
 * event). Kept in sync with resolveEmbeddingProvider — INVARIANT: for any
 * given SystemConfig state, `(await resolveEmbeddingProvider(opts)).model ===
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
