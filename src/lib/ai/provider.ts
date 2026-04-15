import { getPlainConfigValue, getConfigValue } from "@/lib/system-config";
import { resolveApiKey } from "@/lib/chat/api-key";
import { isSafeAiProviderUrl } from "@/lib/validation";
import { resolveLocalAiAuthMode } from "./local-auth";
import { OllamaProvider } from "./ollama-provider";
import { GeminiProvider } from "./gemini-provider";
import type { AIProvider, AIProviderType } from "./types";

const DEFAULT_OLLAMA_MODEL = "gemma4:26b";

/**
 * Resolve the active AI provider based on SystemConfig.
 *
 * - "local" → OllamaProvider (reads ai_provider_url, ai_provider_model)
 * - "cloud" or unset → GeminiProvider (uses existing API key resolution)
 */
export async function getProvider(studentId: string): Promise<AIProvider> {
  const providerType = ((await getPlainConfigValue("ai_provider")) || "cloud") as AIProviderType;

  if (providerType === "local") {
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

  // Default: cloud (Gemini)
  const apiKey = await resolveApiKey(studentId);
  return new GeminiProvider(apiKey);
}
