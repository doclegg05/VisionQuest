import { buildLocalAiHeaders, DEFAULT_LOCAL_AI_AUTH_MODE } from "./local-auth";
import type { AIProvider, ChatMessage, LocalAIAuthConfig } from "./types";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
}

interface NativeChatResponse {
  message?: {
    content?: string;
  };
  done?: boolean;
}

type OllamaApiMode = "unknown" | "openai" | "native";

function toOpenAIMessages(
  systemPrompt: string,
  messages: ChatMessage[],
): OpenAIMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: (m.role === "model" ? "assistant" : "user") as "user" | "assistant",
      content: m.content,
    })),
  ];
}

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly authConfig: LocalAIAuthConfig;
  private apiMode: OllamaApiMode = "unknown";

  /**
   * Timeout for non-streaming requests (full generation must complete).
   * The local relay sends heartbeats to keep Cloudflare's tunnel alive,
   * so this can be generous. 5 minutes covers large prompts on CPU.
   */
  private static readonly GENERATE_TIMEOUT_MS = 300_000;

  /**
   * Timeout for streaming requests (first byte from relay must arrive).
   * The relay responds immediately with headers and sends heartbeat
   * pings every 25s, so this only needs to cover the initial connection.
   * 5 minutes allows for slow prompt evaluation on CPU hardware.
   */
  private static readonly STREAM_FIRST_BYTE_TIMEOUT_MS = 300_000;

  constructor(
    baseUrl: string,
    model: string,
    authConfigOrApiKey?: LocalAIAuthConfig | string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.authConfig =
      typeof authConfigOrApiKey === "string"
        ? {
            authMode: "bearer",
            apiKey: authConfigOrApiKey,
          }
        : {
            authMode:
              authConfigOrApiKey?.authMode ?? DEFAULT_LOCAL_AI_AUTH_MODE,
            apiKey: authConfigOrApiKey?.apiKey ?? null,
            cloudflareAccessClientId:
              authConfigOrApiKey?.cloudflareAccessClientId ?? null,
            cloudflareAccessClientSecret:
              authConfigOrApiKey?.cloudflareAccessClientSecret ?? null,
          };
  }

  private get headers(): Record<string, string> {
    return buildLocalAiHeaders(this.authConfig, {
      "Content-Type": "application/json",
    });
  }

  /**
   * Create a fetch call with an AbortController timeout.
   * Cloudflare Tunnel returns 524 if the origin takes >100s to send
   * the first byte.  We abort before that threshold so callers get a
   * clear timeout error instead of a cryptic 524.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async postOpenAIChat(
    body: unknown,
    timeoutMs = OllamaProvider.GENERATE_TIMEOUT_MS,
  ): Promise<Response> {
    return this.fetchWithTimeout(
      `${this.baseUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
  }

  private async postNativeChat(
    body: unknown,
    timeoutMs = OllamaProvider.GENERATE_TIMEOUT_MS,
  ): Promise<Response> {
    return this.fetchWithTimeout(
      `${this.baseUrl}/api/chat`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
  }

  private async postChat(
    openAIBody: unknown,
    nativeBody: unknown,
    timeoutMs = OllamaProvider.GENERATE_TIMEOUT_MS,
  ): Promise<{ mode: Exclude<OllamaApiMode, "unknown">; response: Response }> {
    if (this.apiMode === "native") {
      const response = await this.postNativeChat(nativeBody, timeoutMs);
      return { mode: "native", response };
    }

    const openAIResponse = await this.postOpenAIChat(openAIBody, timeoutMs);
    if (openAIResponse.status !== 404) {
      if (openAIResponse.ok) {
        this.apiMode = "openai";
      }
      return { mode: "openai", response: openAIResponse };
    }

    const nativeResponse = await this.postNativeChat(nativeBody, timeoutMs);
    if (nativeResponse.ok) {
      this.apiMode = "native";
    }
    return { mode: "native", response: nativeResponse };
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const openAIMessages = toOpenAIMessages(systemPrompt, messages);
    const { mode, response } = await this.postChat(
      {
        model: this.model,
        messages: openAIMessages,
        stream: false,
      },
      {
        model: this.model,
        messages: openAIMessages,
        stream: false,
        keep_alive: "10m",
      },
    );

    if (!response.ok) {
      throw new Error(`Local AI request failed (${response.status})`);
    }

    const data = (await response.json()) as OpenAIChatResponse | NativeChatResponse;
    return mode === "openai"
      ? (data as OpenAIChatResponse).choices?.[0]?.message?.content ?? ""
      : (data as NativeChatResponse).message?.content ?? "";
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): AsyncGenerator<string> {
    const openAIMessages = toOpenAIMessages(systemPrompt, messages);
    // Use the streaming-specific timeout (first-byte only).
    // Once the first byte arrives, Cloudflare keeps the connection alive
    // as long as data continues to flow.
    const { mode, response } = await this.postChat(
      {
        model: this.model,
        messages: openAIMessages,
        stream: true,
      },
      {
        model: this.model,
        messages: openAIMessages,
        stream: true,
        keep_alive: "10m",
      },
      OllamaProvider.STREAM_FIRST_BYTE_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new Error(`Local AI stream failed (${response.status})`);
    }

    if (!response.body) throw new Error("Ollama returned empty stream body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (mode === "openai") {
          if (!trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") return;

          let parsed: OpenAIStreamChunk;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
          continue;
        }

        let parsed: NativeChatResponse;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const content = parsed.message?.content;
        if (content) yield content;
        if (parsed.done) return;
      }
    }

    const finalChunk = buffer.trim();
    if (!finalChunk) return;

    if (mode === "openai") {
      if (!finalChunk.startsWith("data: ")) return;
      const payload = finalChunk.slice(6);
      if (payload === "[DONE]") return;

      try {
        const parsed = JSON.parse(payload) as OpenAIStreamChunk;
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch {
        return;
      }
      return;
    }

    try {
      const parsed = JSON.parse(finalChunk) as NativeChatResponse;
      const content = parsed.message?.content;
      if (content) yield content;
    } catch {
      return;
    }
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const openAIMessages = toOpenAIMessages(systemPrompt, messages);
    const { mode, response } = await this.postChat(
      {
        model: this.model,
        messages: openAIMessages,
        stream: false,
        response_format: { type: "json_object" },
      },
      {
        model: this.model,
        messages: openAIMessages,
        stream: false,
        format: "json",
        keep_alive: "10m",
      },
    );

    if (!response.ok) {
      throw new Error(`Local AI structured request failed (${response.status})`);
    }

    const data = (await response.json()) as OpenAIChatResponse | NativeChatResponse;
    return mode === "openai"
      ? (data as OpenAIChatResponse).choices?.[0]?.message?.content ?? ""
      : (data as NativeChatResponse).message?.content ?? "";
  }
}
