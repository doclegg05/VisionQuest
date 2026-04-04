import { getPlainConfigValue } from "@/lib/system-config";
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
    const url = await getPlainConfigValue("ai_provider_url");
    if (!url) {
      throw new Error(
        "Local AI server URL is not configured. Set it in Program Setup > AI Provider.",
      );
    }
    const model =
      (await getPlainConfigValue("ai_provider_model")) || DEFAULT_OLLAMA_MODEL;
    return new OllamaProvider(url, model);
  }

  // Default: cloud (Gemini)
  const apiKey = await resolveApiKey(studentId);
  return new GeminiProvider(apiKey);
}
