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
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderType,
  DataSensitivity,
  PromptTier,
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

// Bounds for the output-token cap. 128 is the floor for a usable coaching
// reply; the ceiling stays under the smallest supported num_ctx so the cap
// can never squeeze out the prompt itself.
const MAX_OUTPUT_TOKENS_MIN = 128;
const MAX_OUTPUT_TOKENS_MAX = 32768;

function parseMaxOutputTokensOverride(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < MAX_OUTPUT_TOKENS_MIN || parsed > MAX_OUTPUT_TOKENS_MAX) return undefined;
  return parsed;
}

/**
 * Reasoning is OFF unless explicitly enabled: on a thinking model the
 * reasoning channel draws from the same output budget as the reply and can
 * consume all of it, leaving the caller with nothing.
 */
function parseReasoningOverride(raw: string | null): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "on" || normalized === "true" || normalized === "1";
}

async function getLocalProvider(): Promise<AIProvider> {
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
    config.model || DEFAULT_OLLAMA_MODEL,
    toLocalAiAuthConfig(config, {
      numCtx: parseNumCtxOverride(config.numCtxRaw),
      reasoning: parseReasoningOverride(config.reasoningRaw),
      maxOutputTokens: parseMaxOutputTokensOverride(config.maxOutputTokensRaw),
    }),
  );
}

function isLocalOnlySensitivity(sensitivity: DataSensitivity): boolean {
  return sensitivity === "student_record" || sensitivity === "staff_entered";
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
  if (isLocalOnlySensitivity(request.sensitivity)) {
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

export function getPromptTier(provider: AIProvider): PromptTier {
  return provider.name === "ollama" ? "compact" : "full";
}
