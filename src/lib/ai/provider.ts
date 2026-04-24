import { getPlainConfigValue, getConfigValue } from "@/lib/system-config";
import { resolveApiKey } from "@/lib/chat/api-key";
import { isSafeAiProviderUrl } from "@/lib/validation";
import { resolveLocalAiAuthMode } from "./local-auth";
import { OllamaProvider } from "./ollama-provider";
import { GeminiProvider } from "./gemini-provider";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderType,
  DataSensitivity,
  PromptTier,
} from "./types";

const DEFAULT_OLLAMA_MODEL = "gemma4:26b";

async function getConfiguredProviderType(): Promise<AIProviderType> {
  const providerType = await getPlainConfigValue("ai_provider");
  return providerType === "local" ? "local" : "cloud";
}

async function getCloudProvider(studentId: string): Promise<AIProvider> {
  const apiKey = await resolveApiKey(studentId);
  return new GeminiProvider(apiKey);
}

async function getLocalProvider(): Promise<AIProvider> {
  const [
    url,
    model,
    authModeRaw,
    apiKey,
    cloudflareAccessClientId,
    cloudflareAccessClientSecret,
  ] = await Promise.all([
    getPlainConfigValue("ai_provider_url"),
    getPlainConfigValue("ai_provider_model"),
    getPlainConfigValue("ai_provider_auth_mode"),
    getConfigValue("ai_provider_api_key"),
    getConfigValue("ai_provider_cloudflare_access_client_id"),
    getConfigValue("ai_provider_cloudflare_access_client_secret"),
  ]);
  if (!url) {
    throw new Error(
      "Local AI server URL is not configured. Set it in Program Setup > AI Provider.",
    );
  }
  if (!isSafeAiProviderUrl(url)) {
    throw new Error(
      "Local AI server URL is invalid. Use localhost/127.0.0.1/::1 or a public http/https endpoint.",
    );
  }
  return new OllamaProvider(url, model || DEFAULT_OLLAMA_MODEL, {
    authMode: resolveLocalAiAuthMode(authModeRaw),
    apiKey,
    cloudflareAccessClientId,
    cloudflareAccessClientSecret,
  });
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
 * prompts are local-only so FERPA-sensitive data never falls back to Gemini.
 */
export async function resolveAiProvider(
  request: AIProviderRequest,
): Promise<AIProvider> {
  if (isLocalOnlySensitivity(request.sensitivity)) {
    return getLocalProvider();
  }

  if (request.preferCloud && request.sensitivity === "public_program") {
    return getCloudProvider(request.studentId);
  }

  return getProvider(request.studentId);
}

export function getPromptTier(provider: AIProvider): PromptTier {
  return provider.name === "ollama" ? "compact" : "full";
}
