import { getPlainConfigValue } from "@/lib/system-config";
import { resolveApiKey } from "@/lib/chat/api-key";
import { isSafeAiProviderUrl } from "@/lib/validation";
import {
  DEFAULT_OLLAMA_MODEL,
  readLocalAiProviderConfig,
  toLocalAiAuthConfig,
} from "./local-config";
import { OllamaProvider } from "./ollama-provider";
import { GeminiProvider } from "./gemini-provider";
import { LocalQualityFallbackProvider } from "./local-quality-fallback-provider";
import {
  isLocalTaskRoutingEnabled,
  isProtectedSensitivity,
  readLocalTaskRoutingConfig,
  selectLocalModel,
  type LocalTaskRoutingConfig,
} from "./task-router";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderType,
  PromptTier,
  LocalRoutingMetadata,
} from "./types";

async function getConfiguredProviderType(): Promise<AIProviderType> {
  const providerType = await getPlainConfigValue("ai_provider");
  return providerType === "local" ? "local" : "cloud";
}

async function getCloudProvider(studentId: string): Promise<AIProvider> {
  const apiKey = await resolveApiKey(studentId);
  return new GeminiProvider(apiKey);
}

// Bounds for the Ollama num_ctx override. 1024 is the floor for any
// useful conversation; 131072 matches the largest context window
// supported by current open-weights models (Llama 3.x, Qwen 2.5).
const NUM_CTX_MIN = 1024;
const NUM_CTX_MAX = 131072;

function parseNumCtxOverride(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < NUM_CTX_MIN || parsed > NUM_CTX_MAX) return undefined;
  return parsed;
}

async function getLocalProvider(modelOverride?: string): Promise<AIProvider> {
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
  return new OllamaProvider(
    config.url,
    modelOverride || config.model || DEFAULT_OLLAMA_MODEL,
    toLocalAiAuthConfig(config, {
      numCtx: parseNumCtxOverride(config.numCtxRaw),
    }),
  );
}

async function getTaskRoutedLocalProvider(
  request: AIProviderRequest,
  config: LocalTaskRoutingConfig,
): Promise<AIProvider> {
  const decision = selectLocalModel(request, config);
  const metadata: LocalRoutingMetadata = {
    taskClass: decision.taskClass,
    requestedTier: decision.requestedTier,
    selectedTier: decision.selectedTier,
    model: decision.model,
    fallbackModel:
      decision.selectedTier === "quality" ? config.defaultModel : null,
    buffersBeforeOutput: decision.selectedTier === "quality",
  };

  if (decision.selectedTier === "quality") {
    const [qualityProvider, defaultProvider] = await Promise.all([
      getLocalProvider(decision.model),
      getLocalProvider(config.defaultModel),
    ]);
    return new LocalQualityFallbackProvider(
      qualityProvider,
      defaultProvider,
      decision.model,
      config.defaultModel,
      decision.taskClass,
    );
  }

  const provider = await getLocalProvider(decision.model);
  Object.defineProperty(provider, "localRouting", {
    value: metadata,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return provider;
}

/**
 * Resolve the active AI provider based on SystemConfig.
 *
 * - "local" -> OllamaProvider (reads ai_provider_url, ai_provider_model)
 * - "cloud" or unset -> GeminiProvider (uses existing API key resolution)
 *
 * Prefer resolveAiProvider() for new call sites so the task's data
 * sensitivity is explicit.
 */
export async function getProvider(studentId: string): Promise<AIProvider> {
  const providerType = await getConfiguredProviderType();
  return providerType === "local"
    ? getLocalProvider()
    : getCloudProvider(studentId);
}

/**
 * Resolve a provider for a specific task. Student-record and staff-entered
 * prompts are FERPA-sensitive and route to a local model when one is
 * configured (`ai_provider = "local"`). During alpha/pre-hardware testing
 * the operator can flip `ai_provider = "cloud"` to honor the configured
 * cloud provider for these prompts too — every request is still recorded
 * in the AI audit log so the data path remains auditable.
 */
export async function resolveAiProvider(
  request: AIProviderRequest,
): Promise<AIProvider> {
  const taskRoutingEnabled = await isLocalTaskRoutingEnabled();

  // Exact legacy behavior unless an operator explicitly enables the staged
  // task router. This preserves current production routing and defaults.
  if (!taskRoutingEnabled) {
    if (isProtectedSensitivity(request.sensitivity)) {
      const providerType = await getConfiguredProviderType();
      if (providerType === "local") {
        return getLocalProvider();
      }
      return getCloudProvider(request.studentId);
    }

    if (request.preferCloud && request.sensitivity === "public_program") {
      return getCloudProvider(request.studentId);
    }

    return getProvider(request.studentId);
  }

  const routingConfig = await readLocalTaskRoutingConfig();

  // With rollout enabled, protected records are local-only regardless of the
  // legacy provider switch. Missing/unsafe local config or unavailable Gemma
  // throws before any cloud key is resolved.
  if (isProtectedSensitivity(request.sensitivity)) {
    return getTaskRoutedLocalProvider(request, routingConfig);
  }

  // Public/de-identified/system work retains the existing cloud/local policy.
  if (request.preferCloud && request.sensitivity === "public_program") {
    return getCloudProvider(request.studentId);
  }

  const providerType = await getConfiguredProviderType();
  if (providerType === "local") {
    return getTaskRoutedLocalProvider(request, routingConfig);
  }
  return getCloudProvider(request.studentId);
}

export function getPromptTier(provider: AIProvider): PromptTier {
  return provider.name === "ollama" ? "compact" : "full";
}
