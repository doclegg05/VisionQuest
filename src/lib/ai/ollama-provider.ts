import type { AIProvider, ChatMessage } from "./types";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

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

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: toOpenAIMessages(systemPrompt, messages),
        stream: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama request failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): AsyncGenerator<string> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: toOpenAIMessages(systemPrompt, messages),
        stream: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama stream failed (${res.status}): ${text}`);
    }

    const reader = res.body!.getReader();
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
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") return;

        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      }
    }
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: toOpenAIMessages(systemPrompt, messages),
        stream: false,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama structured request failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  }
}
