import { randomUUID } from "crypto";
import { buildLocalAiHeaders, DEFAULT_LOCAL_AI_AUTH_MODE } from "./local-auth";
import type {
  AIProvider,
  ChatMessage,
  LocalAIAuthConfig,
  ToolCallHandler,
  ToolDeclaration,
  ToolStreamEvent,
  ToolStreamOptions,
} from "./types";

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant turns that called one or more tools. */
  tool_calls?: OpenAIToolCallMessage[];
  /** Present on tool-result turns; references the assistant tool_call id. */
  tool_call_id?: string;
  /** Optional name field for tool-role messages. */
  name?: string;
}

interface OpenAIToolCallMessage {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // stringified JSON
  };
}

/** Streaming delta for tool calls (OpenAI-compat format). */
interface OpenAIStreamToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** Tool call shape returned by Ollama's native /api/chat (non-streaming-style). */
interface NativeToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string; // accumulated JSON string
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
      tool_calls?: OpenAIStreamToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
}

interface NativeChatResponse {
  message?: {
    content?: string;
    tool_calls?: NativeToolCall[];
  };
  done?: boolean;
}

type OllamaApiMode = "unknown" | "openai" | "native";

class LocalAiStreamError extends Error {
  readonly switchToNative: boolean;

  constructor(message: string, options: { switchToNative?: boolean } = {}) {
    super(message);
    this.name = "LocalAiStreamError";
    this.switchToNative = options.switchToNative ?? false;
  }
}

const STREAM_STARTUP_RETRY_DELAYS_MS = [0, 1_000, 3_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function payloadErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null;
  }

  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Local AI returned an error.";
}

function isRetryableStartupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Relay:|ECONNREFUSED|fetch failed|socket hang up|terminated|aborted|timed out|timeout|Local AI stream failed \((?:502|503|504|520|522|523|524)\)|Ollama returned (?:502|503|504|520|522|523|524)/i.test(message);
}

function shouldSwitchToNative(message: string): boolean {
  return /Ollama returned 404|Local AI stream failed \(404\)/i.test(message);
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
  private static readonly NUM_CTX = 4096;

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
        num_ctx: OllamaProvider.NUM_CTX,
      },
      {
        model: this.model,
        messages: openAIMessages,
        stream: false,
        options: { num_ctx: OllamaProvider.NUM_CTX },
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

  private async *streamResponseOnce(
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
        num_ctx: OllamaProvider.NUM_CTX,
      },
      {
        model: this.model,
        messages: openAIMessages,
        stream: true,
        options: { num_ctx: OllamaProvider.NUM_CTX },
        keep_alive: "10m",
      },
      OllamaProvider.STREAM_FIRST_BYTE_TIMEOUT_MS,
    );

    if (!response.ok) {
      const message = `Local AI stream failed (${response.status})`;
      throw new LocalAiStreamError(message, {
        switchToNative: shouldSwitchToNative(message),
      });
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
          const upstreamError = payloadErrorMessage(parsed);
          if (upstreamError) {
            throw new LocalAiStreamError(upstreamError, {
              switchToNative: shouldSwitchToNative(upstreamError),
            });
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
        const upstreamError = payloadErrorMessage(parsed);
        if (upstreamError) {
          throw new LocalAiStreamError(upstreamError);
        }
        const content = parsed.message?.content;
        if (content) yield content;
        if (parsed.done) return;
      }
    }

    buffer += decoder.decode();
    const finalChunk = buffer.trim();
    if (!finalChunk) return;

    if (mode === "openai") {
      if (!finalChunk.startsWith("data: ")) return;
      const payload = finalChunk.slice(6);
      if (payload === "[DONE]") return;

      let parsed: OpenAIStreamChunk;
      try {
        parsed = JSON.parse(payload) as OpenAIStreamChunk;
      } catch {
        return;
      }
      const upstreamError = payloadErrorMessage(parsed);
      if (upstreamError) {
        throw new LocalAiStreamError(upstreamError, {
          switchToNative: shouldSwitchToNative(upstreamError),
        });
      }
      const content = parsed.choices?.[0]?.delta?.content;
      if (content) yield content;
      return;
    }

    let parsed: NativeChatResponse;
    try {
      parsed = JSON.parse(finalChunk) as NativeChatResponse;
    } catch {
      return;
    }
    const upstreamError = payloadErrorMessage(parsed);
    if (upstreamError) {
      throw new LocalAiStreamError(upstreamError);
    }
    const content = parsed.message?.content;
    if (content) yield content;
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): AsyncGenerator<string> {
    let lastError: unknown = null;
    let yieldedAny = false;

    for (let attempt = 0; attempt <= STREAM_STARTUP_RETRY_DELAYS_MS.length; attempt++) {
      let yieldedThisAttempt = false;
      try {
        for await (const chunk of this.streamResponseOnce(systemPrompt, messages)) {
          yieldedAny = true;
          yieldedThisAttempt = true;
          yield chunk;
        }

        if (yieldedThisAttempt) return;
        throw new LocalAiStreamError("Local AI stream ended without content.");
      } catch (error) {
        lastError = error;
        if (error instanceof LocalAiStreamError && error.switchToNative) {
          this.apiMode = "native";
        }

        const canRetry =
          !yieldedAny &&
          attempt < STREAM_STARTUP_RETRY_DELAYS_MS.length &&
          (
            (error instanceof LocalAiStreamError && error.switchToNative) ||
            isRetryableStartupError(error)
          );

        if (!canRetry) throw error;

        const delay = STREAM_STARTUP_RETRY_DELAYS_MS[attempt];
        if (delay > 0) await sleep(delay);
      }
    }

    if (lastError) throw lastError;
  }

  /**
   * Streaming completion with function-calling support.
   *
   * Drives a multi-hop tool-call loop:
   *   1. Stream a turn from Ollama with the tools array attached.
   *   2. Yield text chunks as they arrive.
   *   3. After the stream ends, inspect for tool_calls.
   *   4. If tool calls exist: execute via onToolCall, push assistant +
   *      tool messages onto the conversation, and stream the next hop.
   *   5. If no tool calls: emit done(complete) and return.
   *
   * Supports both API modes the rest of the provider already handles —
   * OpenAI-compat at /v1/chat/completions and native at /api/chat.
   * Both Ollama paths support tool calling natively.
   */
  async *streamWithTools(
    systemPrompt: string,
    messages: ChatMessage[],
    tools: ToolDeclaration[],
    onToolCall: ToolCallHandler,
    options?: ToolStreamOptions,
  ): AsyncGenerator<ToolStreamEvent> {
    if (messages.length === 0) throw new Error("messages array must not be empty");
    const maxHops = Math.max(1, options?.maxHops ?? 5);

    // No tools registered → degrade to plain streaming.
    if (tools.length === 0) {
      for await (const text of this.streamResponse(systemPrompt, messages)) {
        yield { kind: "text", text };
      }
      yield { kind: "done", reason: "complete" };
      return;
    }

    const ollamaTools = tools.map(toOllamaTool);
    const conversation: OpenAIMessage[] = toOpenAIMessages(systemPrompt, messages);

    for (let hop = 0; hop < maxHops; hop++) {
      // Stream one hop. The inner generator yields text strings as they
      // arrive and returns a final summary with collected tool calls.
      const hopGen = this.streamHopOnce(conversation, ollamaTools);
      const accumulatedText: string[] = [];
      let hopResult: HopResult;

      while (true) {
        const next = await hopGen.next();
        if (next.done) {
          hopResult = next.value;
          break;
        }
        accumulatedText.push(next.value);
        yield { kind: "text", text: next.value };
      }

      if (hopResult.toolCalls.length === 0) {
        yield { kind: "done", reason: "complete" };
        return;
      }

      // Push the assistant message (text + tool_calls) so the model can
      // reason about its own prior turn on the next hop.
      conversation.push({
        role: "assistant",
        content: accumulatedText.join(""),
        tool_calls: hopResult.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      });

      // Execute every tool call, surfacing events to the caller and
      // appending tool-role responses so the next hop can use them.
      for (const call of hopResult.toolCalls) {
        const args = parseToolArguments(call.arguments);
        yield { kind: "tool_call", callId: call.id, name: call.name, args };

        const handlerResult = await onToolCall({ name: call.name, args });

        yield {
          kind: "tool_result",
          callId: call.id,
          name: call.name,
          status: handlerResult.status,
          summary: handlerResult.summary,
          response: handlerResult.response,
        };

        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.name,
          content: serializeToolResponseContent(handlerResult.response, handlerResult.summary),
        });
      }
    }

    yield { kind: "done", reason: "max_hops" };
  }

  /**
   * Stream a single hop with tools attached. Yields text deltas and
   * returns the accumulated tool-call list. Switches between OpenAI
   * and native API modes the same way streamResponseOnce does.
   */
  private async *streamHopOnce(
    conversation: OpenAIMessage[],
    ollamaTools: OllamaToolPayload[],
  ): AsyncGenerator<string, HopResult> {
    const openAIBody = {
      model: this.model,
      messages: conversation,
      stream: true,
      tools: ollamaTools,
      num_ctx: OllamaProvider.NUM_CTX,
    };
    const nativeBody = {
      model: this.model,
      messages: conversation,
      stream: true,
      tools: ollamaTools,
      options: { num_ctx: OllamaProvider.NUM_CTX },
      keep_alive: "10m",
    };

    const { mode, response } = await this.postChat(
      openAIBody,
      nativeBody,
      OllamaProvider.STREAM_FIRST_BYTE_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new Error(`Local AI tool stream failed (${response.status})`);
    }
    if (!response.body) throw new Error("Ollama returned empty stream body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolCalls = new Map<number, AccumulatedToolCall>();
    // Native mode doesn't have a stable index per call; use insertion order.
    let nativeIndex = 0;

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
          if (payload === "[DONE]") {
            return { toolCalls: Array.from(toolCalls.values()) };
          }

          let parsed: OpenAIStreamChunk;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }
          const upstreamError = payloadErrorMessage(parsed);
          if (upstreamError) {
            throw new Error(upstreamError);
          }

          const choice = parsed.choices?.[0];
          const text = choice?.delta?.content;
          if (text) yield text;

          const callDeltas = choice?.delta?.tool_calls;
          if (callDeltas) {
            for (const delta of callDeltas) {
              accumulateOpenAIToolCall(toolCalls, delta);
            }
          }
          continue;
        }

        // Native mode: each line is a complete JSON object.
        let parsed: NativeChatResponse;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const upstreamError = payloadErrorMessage(parsed);
        if (upstreamError) throw new Error(upstreamError);

        const text = parsed.message?.content;
        if (text) yield text;

        const calls = parsed.message?.tool_calls;
        if (calls) {
          for (const call of calls) {
            const id = `native-${nativeIndex++}-${randomUUID().slice(0, 8)}`;
            const argString =
              typeof call.function.arguments === "string"
                ? call.function.arguments
                : JSON.stringify(call.function.arguments ?? {});
            toolCalls.set(toolCalls.size, {
              id,
              name: call.function.name,
              arguments: argString,
            });
          }
        }

        if (parsed.done) {
          return { toolCalls: Array.from(toolCalls.values()) };
        }
      }
    }

    // Drain any final partial line.
    buffer += decoder.decode();
    return { toolCalls: Array.from(toolCalls.values()) };
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
        num_ctx: OllamaProvider.NUM_CTX,
      },
      {
        model: this.model,
        messages: openAIMessages,
        stream: false,
        format: "json",
        options: { num_ctx: OllamaProvider.NUM_CTX },
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

// ---------------------------------------------------------------------------
// Tool-calling helpers
// ---------------------------------------------------------------------------

interface OllamaToolPayload {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolDeclaration["parameters"];
  };
}

interface HopResult {
  toolCalls: AccumulatedToolCall[];
}

function toOllamaTool(tool: ToolDeclaration): OllamaToolPayload {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/**
 * OpenAI-compatible streaming sends tool calls as deltas. Each delta has
 * an `index` identifying which call it belongs to, and may include any
 * combination of `id`, `function.name`, and incremental
 * `function.arguments` fragments. We accumulate by index until the
 * stream completes, then parse the final argument string.
 */
function accumulateOpenAIToolCall(
  acc: Map<number, AccumulatedToolCall>,
  delta: OpenAIStreamToolCallDelta,
): void {
  const idx = delta.index;
  const existing = acc.get(idx);
  if (!existing) {
    acc.set(idx, {
      id: delta.id ?? randomUUID(),
      name: delta.function?.name ?? "",
      arguments: delta.function?.arguments ?? "",
    });
    return;
  }
  if (delta.id && !existing.id) existing.id = delta.id;
  if (delta.function?.name && !existing.name) existing.name = delta.function.name;
  if (delta.function?.arguments) existing.arguments += delta.function.arguments;
}

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function serializeToolResponseContent(response: unknown, summary: string): string {
  if (typeof response === "string") return response;
  const enriched =
    response && typeof response === "object" && !Array.isArray(response)
      ? { ...(response as Record<string, unknown>), _summary: summary }
      : { result: response, _summary: summary };
  return JSON.stringify(enriched);
}
