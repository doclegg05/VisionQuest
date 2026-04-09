import { getPlainConfigValue, getConfigValue } from "@/lib/system-config";
import { resolveApiKey } from "@/lib/chat/api-key";
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
    const [url, model, apiKey] = await Promise.all([
      getPlainConfigValue("ai_provider_url"),
      getPlainConfigValue("ai_provider_model"),
      getConfigValue("ai_provider_api_key"),
    ]);
    if (!url) {
      throw new Error(
        "Local AI server URL is not configured. Set it in Program Setup > AI Provider.",
      );
    }
    return new OllamaProvider(url, model || DEFAULT_OLLAMA_MODEL, apiKey || undefined);
  }

  // Default: cloud (Gemini)
  const apiKey = await resolveApiKey(studentId);
  return new GeminiProvider(apiKey);
}
