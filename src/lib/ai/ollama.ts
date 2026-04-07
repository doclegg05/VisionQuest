import type { AIProvider, ChatMessage } from "./types";
import { validateMessages } from "./types";
import { logger } from "@/lib/logger";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT = 300_000; // 5 minutes for CPU inference

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatResponse {
  choices: Array<{
    message: { content: string };
  }>;
}

export class OllamaProvider implements AIProvider {
  readonly modelName: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private healthCheckedAt = 0;
  private static readonly HEALTH_TTL = 60_000; // 60 seconds

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE_URL;
    this.modelName = process.env.OLLAMA_MODEL?.trim() || "gemma4:latest";
    this.timeout = Number(process.env.OLLAMA_TIMEOUT) || DEFAULT_TIMEOUT;
  }

  private toOllamaMessages(
    systemPrompt: string,
    messages: ChatMessage[],
  ): OllamaMessage[] {
    const mapped: OllamaMessage[] = [
      { role: "system", content: systemPrompt },
    ];
    for (const m of messages) {
      mapped.push({
        role: m.role === "model" ? "assistant" : "user",
        content: m.content,
      });
    }
    return mapped;
  }

  private async healthCheck(): Promise<void> {
    const now = Date.now();
    if (now - this.healthCheckedAt < OllamaProvider.HEALTH_TTL) return;

    let tagsResponse: Response;
    try {
      tagsResponse = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new Error(
        `Ollama is not running at ${this.baseUrl}. Start Ollama or set AI_PROVIDER=gemini in .env.local`,
      );
    }

    if (!tagsResponse.ok) {
      throw new Error(
        `Ollama health check failed (${tagsResponse.status}). Start Ollama or set AI_PROVIDER=gemini in .env.local`,
      );
    }

    const data = (await tagsResponse.json()) as {
      models: Array<{ name: string }>;
    };
    const modelNames = data.models.map((m) => m.name);
    const requested = this.modelName.includes(":")
      ? this.modelName
      : `${this.modelName}:latest`;

    if (!modelNames.some((n) => n === requested || n.startsWith(this.modelName))) {
      throw new Error(
        `Model '${this.modelName}' not found in Ollama. Run: ollama pull ${this.modelName}`,
      );
    }

    this.healthCheckedAt = now;
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    validateMessages(messages);
    await this.healthCheck();

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.modelName,
        messages: this.toOllamaMessages(systemPrompt, messages),
        stream: false,
      }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "unknown error");
      throw new Error(`Ollama error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    return data.choices[0].message.content;
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    validateMessages(messages);
    await this.healthCheck();

    const controller = new AbortController();
    // Abort on both external signal and timeout
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    signal?.addEventListener("abort", () => controller.abort(), { once: true });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelName,
          messages: this.toOllamaMessages(systemPrompt, messages),
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (signal?.aborted) return;
      throw err;
    }

    if (!response.ok || !response.body) {
      clearTimeout(timeoutId);
      const text = await response.text().catch(() => "unknown error");
      throw new Error(`Ollama stream error (${response.status}): ${text}`);
    }

    try {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      outer: while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") break outer;

          try {
            const parsed = JSON.parse(payload) as {
              choices: Array<{ delta: { content?: string } }>;
            };
            const content = parsed.choices[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    validateMessages(messages);
    await this.healthCheck();

    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelName,
          messages: this.toOllamaMessages(systemPrompt, messages),
          stream: false,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "unknown error");
        throw new Error(`Ollama error (${response.status}): ${text}`);
      }

      const data = (await response.json()) as OllamaChatResponse;
      const content = data.choices[0].message.content;

      // Validate JSON is parseable
      try {
        JSON.parse(content);
        return content;
      } catch {
        lastError = new Error(
          `Ollama returned malformed JSON (attempt ${attempt + 1}/${maxRetries + 1}): ${content.slice(0, 200)}`,
        );
        logger.warn("Ollama structured response retry", {
          attempt: attempt + 1,
          error: lastError.message,
        });
      }
    }

    // All retries exhausted — log and throw so callers can degrade gracefully
    logger.error("Ollama structured response failed after retries", {
      error: lastError?.message,
    });
    throw lastError!;
  }
}
