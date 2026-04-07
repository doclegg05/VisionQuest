// src/lib/ai/types.ts

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface AIProvider {
  readonly name: string;

  /** Non-streaming completion. Returns the full response text. */
  generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string>;

  /** Streaming completion. Yields text chunks as they arrive. */
  streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): AsyncGenerator<string>;

  /** Non-streaming completion with JSON output mode enabled. Returns raw JSON string. */
  generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string>;
}

export type AIProviderType = "cloud" | "local";

export interface AIProviderConfig {
  type: AIProviderType;
  /** Ollama server URL (e.g. "https://llm.example.com" or "http://localhost:11434") */
  url?: string;
  /** Model name for Ollama (e.g. "gemma4:26b") */
  model?: string;
}
