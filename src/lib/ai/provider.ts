import type { AIProvider } from "./types";
import { GeminiProvider } from "./gemini";
import { OllamaProvider } from "./ollama";
import { MockProvider } from "./mock";

let ollamaInstance: OllamaProvider | null = null;

export function getProvider(apiKey?: string): AIProvider {
  const provider = process.env.AI_PROVIDER || "gemini";

  switch (provider) {
    case "ollama":
      if (!ollamaInstance) ollamaInstance = new OllamaProvider();
      return ollamaInstance;
    case "mock":
      return new MockProvider();
    case "gemini":
    default:
      if (!apiKey) {
        throw new Error(
          "Gemini provider requires an API key. Set GEMINI_API_KEY or configure a personal key in Settings.",
        );
      }
      return new GeminiProvider(apiKey);
  }
}

// Re-export types for convenience
export type { AIProvider, ChatMessage } from "./types";
