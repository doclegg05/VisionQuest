import type { AIProvider, ChatMessage } from "./types";

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
  private readonly apiKey: string | null;
  private apiMode: OllamaApiMode = "unknown";

  constructor(baseUrl: string, model: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.apiKey = apiKey || null;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "VisionQuest",
      "ngrok-skip-browser-warning": "true",
    };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async postOpenAIChat(body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });
  }

  private async postNativeChat(body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });
  }

  private async postChat(
    openAIBody: unknown,
    nativeBody: unknown,
  ): Promise<{ mode: Exclude<OllamaApiMode, "unknown">; response: Response }> {
    if (this.apiMode === "native") {
      const response = await this.postNativeChat(nativeBody);
      return { mode: "native", response };
    }

    const openAIResponse = await this.postOpenAIChat(openAIBody);
    if (openAIResponse.status !== 404) {
      if (openAIResponse.ok) {
        this.apiMode = "openai";
      }
      return { mode: "openai", response: openAIResponse };
    }

    const nativeResponse = await this.postNativeChat(nativeBody);
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
      },
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
