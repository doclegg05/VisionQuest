import { getProvider } from "./ai/provider";

// Re-export constants for api-key validation route
export { DEFAULT_GEMINI_MODEL, GEMINI_MODEL } from "./ai/gemini";

export async function generateResponse(
  apiKey: string,
  systemPrompt: string,
  messages: { role: "user" | "model"; content: string }[],
): Promise<string> {
  return getProvider(apiKey).generateResponse(systemPrompt, messages);
}

export async function* streamResponse(
  apiKey: string,
  systemPrompt: string,
  messages: { role: "user" | "model"; content: string }[],
): AsyncGenerator<string> {
  yield* getProvider(apiKey).streamResponse(systemPrompt, messages);
}

export async function generateStructuredResponse(
  apiKey: string,
  systemPrompt: string,
  messages: { role: "user" | "model"; content: string }[],
): Promise<string> {
  return getProvider(apiKey).generateStructuredResponse(systemPrompt, messages);
}
