import { randomUUID } from "crypto";
import { buildLocalAiHeaders, DEFAULT_LOCAL_AI_AUTH_MODE } from "./local-auth";
import { estimateTokens } from "../llm-usage-estimate";
import type {
  AIProvider,
  ChatMessage,
  GenerationOptions,
  LocalAIAuthConfig,
  OnUsage,
  TokenUsage,
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

/**
 * Mutable out-param streaming methods write into when they observe real
 * usage on a chunk. AsyncGenerators can't both yield values to a `for await`
 * loop and return a final value cleanly through every early-return path in
 * this file's retry/fallback logic, so a shared sink is the least invasive
 * way to surface usage from deep inside the SSE parsing loop.
 */
interface UsageSink {
  usage: TokenUsage | null;
}

/** Shared usage shape across the OpenAI-compat REST surface (non-stream and final stream chunk). */
interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
      /** Reasoning channel on thinking models. Never shown to students. */
      reasoning?: string;
    };
    /** "length" when the model hit the output-token cap mid-generation. */
    finish_reason?: string | null;
  }>;
  usage?: OpenAIUsage;
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      /** Reasoning channel on thinking models. Never yielded to callers. */
      reasoning?: string;
      tool_calls?: OpenAIStreamToolCallDelta[];
    };
    message?: {
      content?: string;
    };
    text?: string;
    finish_reason?: string | null;
  }>;
  /** Present only on the final chunk when stream_options.include_usage is set. */
  usage?: OpenAIUsage;
}

interface NativeChatResponse {
  message?: {
    content?: string;
    /** Reasoning channel on thinking models. Never yielded to callers. */
    thinking?: string;
    tool_calls?: NativeToolCall[];
  };
  done?: boolean;
  /** "length" when the model hit num_predict mid-generation. */
  done_reason?: string;
  /** Present on the done:true message from Ollama's native /api/chat. */
  prompt_eval_count?: number;
  eval_count?: number;
}

type OllamaApiMode = "unknown" | "openai" | "native";

class LocalAiStreamError extends Error {
  readonly switchToNative: boolean;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { switchToNative?: boolean; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "LocalAiStreamError";
    this.switchToNative = options.switchToNative ?? false;
    this.retryable = options.retryable ?? true;
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
  return /Relay:|ECONNREFUSED|fetch failed|socket hang up|terminated|aborted|timed out|timeout|Local AI (?:tool )?stream failed \((?:502|503|504|520|522|523|524|525|526|527|530)\)|Ollama returned (?:502|503|504|520|522|523|524|525|526|527|530)/i.test(message);
}

function shouldSwitchToNative(message: string): boolean {
  return /Ollama returned (?:404|502|503|504|520|522|523|524|525|526|527|530)|Local AI (?:tool )?stream failed \((?:404|502|503|504|520|522|523|524|525|526|527|530)\)/i.test(message);
}

function shouldTryNativeAfterOpenAiStatus(status: number): boolean {
  return [404, 502, 503, 504, 520, 522, 523, 524, 525, 526, 527, 530].includes(
    status,
  );
}

function streamChunkContent(parsed: OpenAIStreamChunk): string | undefined {
  const choice = parsed.choices?.[0];
  return choice?.delta?.content ?? choice?.message?.content ?? choice?.text;
}

/** Converts an OpenAI-compat `usage` object into our normalized TokenUsage. */
function usageFromOpenAI(usage: OpenAIUsage | undefined): TokenUsage | null {
  if (!usage) return null;
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.total_tokens ?? inputTokens + outputTokens,
    source: "provider",
  };
}

/** Converts Ollama native /api/chat's prompt_eval_count/eval_count into TokenUsage. */
function usageFromNative(
  promptEvalCount: number | undefined,
  evalCount: number | undefined,
): TokenUsage | null {
  if (promptEvalCount === undefined && evalCount === undefined) return null;
  const inputTokens = promptEvalCount ?? 0;
  const outputTokens = evalCount ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: "provider",
  };
}

function estimatedUsage(inputChars: number, outputChars: number): TokenUsage {
  const inputTokens = estimateTokens(inputChars);
  const outputTokens = estimateTokens(outputChars);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: "estimated",
  };
}

function inputCharsFor(systemPrompt: string, messages: ChatMessage[]): number {
  return systemPrompt.length + messages.reduce((sum, m) => sum + m.content.length, 0);
}

/**
 * Accumulates per-hop usage across a tool-call loop. Input tokens take the
 * LATEST hop's value (already reflects the growing conversation history);
 * output tokens sum across hops. Mirrors GeminiProvider's accumulateUsage.
 */
function accumulateHopUsage(prior: TokenUsage | null, hopUsage: TokenUsage | null): TokenUsage | null {
  if (!hopUsage) return prior;
  const priorOutput = prior?.source === "provider" ? prior.outputTokens : 0;
  const inputTokens = hopUsage.inputTokens;
  const outputTokens = priorOutput + hopUsage.outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: "provider",
  };
}

function parseNativeChatPayload(payload: string): NativeChatResponse | null {
  let parsed: NativeChatResponse;
  try {
    parsed = JSON.parse(payload) as NativeChatResponse;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (!("message" in parsed) && !("done" in parsed)) return null;
  return parsed;
}

/** True when the server stopped generation because the output cap was hit. */
function isTruncated(reason: string | null | undefined): boolean {
  return reason === "length";
}

/**
 * Builds the error thrown when a turn ends with no visible content.
 *
 * Reasoning models draw reasoning tokens from the SAME budget as the reply,
 * so a long system prompt can leave nothing for the answer. Returning ""
 * here is what made this invisible: eight eval scenarios reported "empty
 * reply" with nothing wrong in the scenarios.
 */
function noVisibleContentError(
  model: string,
  maxOutputTokens: number,
  reasoningChars: number,
): Error {
  const spentOnReasoning =
    reasoningChars > 0
      ? ` It spent that budget on ${reasoningChars} characters of reasoning, which shares the output budget with the reply.`
      : "";
  return new Error(
    `Local AI model "${model}" hit its ${maxOutputTokens}-token output budget without emitting any visible content.${spentOnReasoning}` +
      ` Disable reasoning for this model (the default) or raise its output budget via ai_provider_max_output_tokens.`,
  );
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
  /**
   * When true, this endpoint is a generic OpenAI-compatible server (LM
   * Studio, vLLM, llama.cpp server) that only exposes /v1/*. Native /api/*
   * calls must never be attempted — not on startup, not as an error
   * fallback — because those routes don't exist on the target server.
   */
  private readonly openAiOnly: boolean;
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

  /**
   * Time allowed for the first real model payload after the relay opens the
   * stream. Relay heartbeats arrive immediately, so a first-byte timeout alone
   * does not catch a stuck CPU model. Keep this below classroom patience and
   * well below the relay's 5-minute upstream timeout.
   */
  private static readonly FIRST_CONTENT_TIMEOUT_MS = 45_000;

  private static readonly DEFAULT_MAX_OUTPUT_TOKENS = 768;
  private static readonly STRUCTURED_MAX_OUTPUT_TOKENS = 512;

  /**
   * How long Ollama should keep the model resident in VRAM after a request.
   * Set to 8h to cover the SPOKES workday (7:30 AM – 3:30 PM) so the model
   * stays warm between messages instead of unloading after each idle gap.
   * Pair with the "Sage Model Warmup" scheduled task to pre-load on login.
   */
  private static readonly KEEP_ALIVE = "8h";

  /**
   * Default KV-cache window size when no SystemConfig override is set.
   * Bumped from 4096 to 8192 to give multi-turn agent transcripts (text +
   * tool_calls + tool results across hops) more headroom before clipping.
   * Most modern open-weights chat models support 32K-128K context, so
   * 8K is conservative; admins can override via `ai_provider_num_ctx`.
   */
  static readonly DEFAULT_NUM_CTX = 8192;
  private readonly numCtx: number;

  /**
   * Whether the model may emit its reasoning ("thinking") channel.
   *
   * Defaults to FALSE. Reasoning tokens come out of the same output budget
   * as the visible reply: measured against gemma4:26b-a4b-it-qat on the real
   * ~20k-char Sage prompt, reasoning consumed all 768 tokens and produced
   * zero visible content, while the same budget with reasoning off returned
   * a complete reply in half the wall-clock time.
   */
  private readonly reasoningEnabled: boolean;
  private readonly maxOutputTokens: number;

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
    const explicitNumCtx =
      typeof authConfigOrApiKey === "object" && authConfigOrApiKey !== null
        ? authConfigOrApiKey.numCtx
        : undefined;
    this.numCtx =
      typeof explicitNumCtx === "number" && explicitNumCtx > 0
        ? explicitNumCtx
        : OllamaProvider.DEFAULT_NUM_CTX;
    this.openAiOnly =
      typeof authConfigOrApiKey === "object" &&
      authConfigOrApiKey !== null &&
      authConfigOrApiKey.apiStyle === "openai";
    if (this.openAiOnly) {
      this.apiMode = "openai";
    }
    const structuredConfig =
      typeof authConfigOrApiKey === "object" && authConfigOrApiKey !== null
        ? authConfigOrApiKey
        : undefined;
    this.reasoningEnabled = structuredConfig?.reasoning ?? false;
    const explicitMaxOutput = structuredConfig?.maxOutputTokens;
    this.maxOutputTokens =
      typeof explicitMaxOutput === "number" && explicitMaxOutput > 0
        ? explicitMaxOutput
        : OllamaProvider.DEFAULT_MAX_OUTPUT_TOKENS;
  }

  /**
   * Reasoning controls for the OpenAI-compat surface.
   *
   * The two Ollama surfaces take DIFFERENT knobs and each silently ignores
   * the other's — verified against Ollama 0.32.4, where `/v1` honors only
   * `reasoning_effort` and ignores `think` without error. Sending the wrong
   * one looks like a fix and changes nothing.
   *
   * Generic OpenAI-compatible servers (LM Studio, vLLM, llama.cpp) are left
   * untouched: their reasoning controls vary and an unknown value can 400
   * the request, which would break setups that work today.
   */
  private get openAiReasoningParams(): Record<string, unknown> {
    if (this.openAiOnly || this.reasoningEnabled) return {};
    return { reasoning_effort: "none" };
  }

  /** Reasoning control for the native /api/chat surface. */
  private get nativeReasoningParams(): Record<string, unknown> {
    if (this.openAiOnly) return {};
    return { think: this.reasoningEnabled };
  }

  private get headers(): Record<string, string> {
    return buildLocalAiHeaders(this.authConfig, {
      "Content-Type": "application/json",
    });
  }

  /**
   * Honor a stream error's request to switch to the native /api/* path —
   * unless this endpoint is configured as OpenAI-only, in which case native
   * routes must never be attempted and we stay on the /v1/* path.
   */
  private requestSwitchToNative(error: unknown): boolean {
    if (this.openAiOnly) return false;
    if (!(error instanceof LocalAiStreamError) || !error.switchToNative) return false;
    this.apiMode = "native";
    return true;
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
    if (openAIResponse.ok) {
      this.apiMode = "openai";
      return { mode: "openai", response: openAIResponse };
    }

    // Generic OpenAI-compatible servers (LM Studio, vLLM, llama.cpp server)
    // only expose /v1/* — never fall back to native /api/chat for them.
    if (this.openAiOnly || !shouldTryNativeAfterOpenAiStatus(openAIResponse.status)) {
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
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): Promise<string> {
    const openAIMessages = toOpenAIMessages(systemPrompt, messages);
    const { mode, response } = await this.postChat(
      {
        model: this.model,
        messages: openAIMessages,
        stream: false,
        max_tokens: this.maxOutputTokens,
        num_ctx: this.numCtx,
        ...this.openAiReasoningParams,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      },
      {
        model: this.model,
        messages: openAIMessages,
        stream: false,
        ...this.nativeReasoningParams,
        options: {
          num_ctx: this.numCtx,
          num_predict: this.maxOutputTokens,
          ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        },
        keep_alive: OllamaProvider.KEEP_ALIVE,
      },
    );

    if (!response.ok) {
      throw new Error(`Local AI request failed (${response.status})`);
    }

    const data = (await response.json()) as OpenAIChatResponse | NativeChatResponse;
    const text =
      mode === "openai"
        ? (data as OpenAIChatResponse).choices?.[0]?.message?.content ?? ""
        : (data as NativeChatResponse).message?.content ?? "";

    // Report the real spend before any throw — a truncated turn still burned
    // tokens, and the ledger should see them.
    if (onUsage) {
      const usage =
        mode === "openai"
          ? usageFromOpenAI((data as OpenAIChatResponse).usage)
          : usageFromNative(
              (data as NativeChatResponse).prompt_eval_count,
              (data as NativeChatResponse).eval_count,
            );
      onUsage(usage ?? estimatedUsage(inputCharsFor(systemPrompt, messages), text.length));
    }

    this.assertVisibleContent(mode, data, text, this.maxOutputTokens);
    return text;
  }

  /**
   * Fail loudly when a turn was cut off by the output cap without producing
   * any visible text. Truncated-but-present content is still usable and
   * passes through; only the all-or-nothing case throws.
   */
  private assertVisibleContent(
    mode: Exclude<OllamaApiMode, "unknown">,
    data: OpenAIChatResponse | NativeChatResponse,
    text: string,
    budget: number,
  ): void {
    if (text) return;

    const truncated =
      mode === "openai"
        ? isTruncated((data as OpenAIChatResponse).choices?.[0]?.finish_reason)
        : isTruncated((data as NativeChatResponse).done_reason);
    if (!truncated) return;

    const reasoningChars =
      mode === "openai"
        ? ((data as OpenAIChatResponse).choices?.[0]?.message?.reasoning ?? "").length
        : ((data as NativeChatResponse).message?.thinking ?? "").length;

    throw noVisibleContentError(this.model, budget, reasoningChars);
  }

  /**
   * Error for a stream that closed without yielding any visible text.
   *
   * When reasoning tokens were seen, this is a budget problem, not a
   * transport one: retrying or switching API surfaces re-runs the same
   * doomed generation and only doubles the wall-clock before failing.
   */
  private streamEndedWithoutContentError(
    mode: Exclude<OllamaApiMode, "unknown">,
    reasoningChars: number,
  ): LocalAiStreamError {
    if (reasoningChars > 0) {
      return new LocalAiStreamError(
        noVisibleContentError(this.model, this.maxOutputTokens, reasoningChars).message,
        { retryable: false, switchToNative: false },
      );
    }
    return new LocalAiStreamError(
      mode === "openai"
        ? "OpenAI-compatible local AI stream ended without content."
        : "Local AI stream ended without content.",
      { switchToNative: mode === "openai" },
    );
  }

  private async *streamResponseOnce(
    systemPrompt: string,
    messages: ChatMessage[],
    usageSink?: UsageSink,
    options?: GenerationOptions,
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
        max_tokens: this.maxOutputTokens,
        num_ctx: this.numCtx,
        stream_options: { include_usage: true },
        ...this.openAiReasoningParams,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      },
      {
        model: this.model,
        messages: openAIMessages,
        stream: true,
        ...this.nativeReasoningParams,
        options: {
          num_ctx: this.numCtx,
          num_predict: this.maxOutputTokens,
          ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        },
        keep_alive: OllamaProvider.KEEP_ALIVE,
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
    let yieldedContent = false;
    /**
     * Reasoning text seen on this stream. Never yielded — it restates the
     * system prompt's meta-instructions and must not reach a student — but
     * counted, so a reasoning-only turn reports the real cause and so a
     * model that is visibly reasoning is not mistaken for a stuck one.
     */
    let reasoningChars = 0;
    let sawTruncation = false;
    const firstContentDeadlineAt =
      Date.now() + OllamaProvider.FIRST_CONTENT_TIMEOUT_MS;

    while (true) {
      const { done, value } = await this.readStreamChunk(
        reader,
        yieldedContent || reasoningChars > 0 ? null : firstContentDeadlineAt,
      );
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (mode === "openai") {
          if (!trimmed.startsWith("data: ")) {
            const nativeParsed = parseNativeChatPayload(trimmed);
            if (!nativeParsed) continue;
            const upstreamError = payloadErrorMessage(nativeParsed);
            if (upstreamError) throw new LocalAiStreamError(upstreamError);
            reasoningChars += (nativeParsed.message?.thinking ?? "").length;
            const content = nativeParsed.message?.content;
            if (content) {
              yieldedContent = true;
              yield content;
            }
            if (nativeParsed.done) {
              if (usageSink) {
                const usage = usageFromNative(nativeParsed.prompt_eval_count, nativeParsed.eval_count);
                if (usage) usageSink.usage = usage;
              }
              if (isTruncated(nativeParsed.done_reason)) sawTruncation = true;
              if (!yieldedContent) {
                throw this.streamEndedWithoutContentError(mode, reasoningChars);
              }
              return;
            }
            continue;
          }
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") {
            if (!yieldedContent) {
              throw this.streamEndedWithoutContentError(mode, reasoningChars);
            }
            return;
          }

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
          if (usageSink) {
            const usage = usageFromOpenAI(parsed.usage);
            if (usage) usageSink.usage = usage;
          }
          reasoningChars += (parsed.choices?.[0]?.delta?.reasoning ?? "").length;
          if (isTruncated(parsed.choices?.[0]?.finish_reason)) sawTruncation = true;
          const content = streamChunkContent(parsed);
          if (content) {
            yieldedContent = true;
            yield content;
          }
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
        reasoningChars += (parsed.message?.thinking ?? "").length;
        const content = parsed.message?.content;
        if (content) {
          yieldedContent = true;
          yield content;
        }
        if (parsed.done) {
          if (usageSink) {
            const usage = usageFromNative(parsed.prompt_eval_count, parsed.eval_count);
            if (usage) usageSink.usage = usage;
          }
          if (isTruncated(parsed.done_reason)) sawTruncation = true;
          if (!yieldedContent) {
            throw this.streamEndedWithoutContentError(mode, reasoningChars);
          }
          return;
        }
      }
    }

    buffer += decoder.decode();
    const finalChunk = buffer.trim();
    if (!finalChunk) {
      if (!yieldedContent && (mode === "openai" || reasoningChars > 0 || sawTruncation)) {
        throw this.streamEndedWithoutContentError(mode, reasoningChars);
      }
      return;
    }

    if (mode === "openai") {
      if (!finalChunk.startsWith("data: ")) {
        const nativeParsed = parseNativeChatPayload(finalChunk);
        if (!nativeParsed) {
          if (!yieldedContent) {
            throw this.streamEndedWithoutContentError(mode, reasoningChars);
          }
          return;
        }
        const upstreamError = payloadErrorMessage(nativeParsed);
        if (upstreamError) throw new LocalAiStreamError(upstreamError);
        reasoningChars += (nativeParsed.message?.thinking ?? "").length;
        const content = nativeParsed.message?.content;
        if (content) yield content;
        if (usageSink) {
          const usage = usageFromNative(nativeParsed.prompt_eval_count, nativeParsed.eval_count);
          if (usage) usageSink.usage = usage;
        }
        if (!content && !yieldedContent) {
          throw this.streamEndedWithoutContentError(mode, reasoningChars);
        }
        return;
      }
      const payload = finalChunk.slice(6);
      if (payload === "[DONE]") {
        if (!yieldedContent) {
          throw this.streamEndedWithoutContentError(mode, reasoningChars);
        }
        return;
      }

      let parsed: OpenAIStreamChunk;
      try {
        parsed = JSON.parse(payload) as OpenAIStreamChunk;
      } catch {
        if (!yieldedContent) {
          throw this.streamEndedWithoutContentError(mode, reasoningChars);
        }
        return;
      }
      const upstreamError = payloadErrorMessage(parsed);
      if (upstreamError) {
        throw new LocalAiStreamError(upstreamError, {
          switchToNative: shouldSwitchToNative(upstreamError),
        });
      }
      if (usageSink) {
        const usage = usageFromOpenAI(parsed.usage);
        if (usage) usageSink.usage = usage;
      }
      reasoningChars += (parsed.choices?.[0]?.delta?.reasoning ?? "").length;
      const content = streamChunkContent(parsed);
      if (content) yield content;
      if (!content && !yieldedContent) {
        throw this.streamEndedWithoutContentError(mode, reasoningChars);
      }
      return;
    }

    let parsed: NativeChatResponse;
    try {
      parsed = JSON.parse(finalChunk) as NativeChatResponse;
    } catch {
      if (!yieldedContent && reasoningChars > 0) {
        throw this.streamEndedWithoutContentError(mode, reasoningChars);
      }
      return;
    }
    const upstreamError = payloadErrorMessage(parsed);
    if (upstreamError) {
      throw new LocalAiStreamError(upstreamError);
    }
    reasoningChars += (parsed.message?.thinking ?? "").length;
    const content = parsed.message?.content;
    if (content) yield content;
    if (!content && !yieldedContent && reasoningChars > 0) {
      throw this.streamEndedWithoutContentError(mode, reasoningChars);
    }
    if (usageSink) {
      const usage = usageFromNative(parsed.prompt_eval_count, parsed.eval_count);
      if (usage) usageSink.usage = usage;
    }
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): AsyncGenerator<string> {
    let lastError: unknown = null;
    let yieldedAny = false;
    let outputChars = 0;
    const usageSink: UsageSink = { usage: null };

    for (let attempt = 0; attempt <= STREAM_STARTUP_RETRY_DELAYS_MS.length; attempt++) {
      let yieldedThisAttempt = false;
      try {
        for await (const chunk of this.streamResponseOnce(systemPrompt, messages, usageSink, options)) {
          yieldedAny = true;
          yieldedThisAttempt = true;
          outputChars += chunk.length;
          yield chunk;
        }

        if (yieldedThisAttempt) {
          onUsage?.(
            usageSink.usage ?? estimatedUsage(inputCharsFor(systemPrompt, messages), outputChars),
          );
          return;
        }
        throw new LocalAiStreamError("Local AI stream ended without content.");
      } catch (error) {
        lastError = error;
        const switchedToNative = this.requestSwitchToNative(error);

        const canRetry =
          !yieldedAny &&
          attempt < STREAM_STARTUP_RETRY_DELAYS_MS.length &&
          (!(error instanceof LocalAiStreamError) || error.retryable) &&
          (switchedToNative || isRetryableStartupError(error));

        if (!canRetry) throw error;

        const delay = STREAM_STARTUP_RETRY_DELAYS_MS[attempt];
        if (delay > 0) await sleep(delay);
      }
    }

    if (lastError) throw lastError;
  }

  private async readStreamChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    firstContentDeadlineAt: number | null,
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    if (firstContentDeadlineAt === null) {
      return reader.read();
    }

    const remainingMs = firstContentDeadlineAt - Date.now();
    if (remainingMs <= 0) {
      await reader.cancel("Local AI first content timeout").catch(() => undefined);
      throw new LocalAiStreamError(
        `Local AI did not produce a first content token within ${Math.round(
          OllamaProvider.FIRST_CONTENT_TIMEOUT_MS / 1000,
        )} seconds.`,
        { retryable: false },
      );
    }

    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(async () => {
            await reader.cancel("Local AI first content timeout").catch(() => undefined);
            reject(
              new LocalAiStreamError(
                `Local AI did not produce a first content token within ${Math.round(
                  OllamaProvider.FIRST_CONTENT_TIMEOUT_MS / 1000,
                )} seconds.`,
                { retryable: false },
              ),
            );
          }, remainingMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async *streamHopWithStartupRetry(
    conversation: OpenAIMessage[],
    ollamaTools: OllamaToolPayload[],
    temperature?: number,
  ): AsyncGenerator<string, HopResult> {
    let lastError: unknown = null;
    let yieldedAny = false;

    for (let attempt = 0; attempt <= STREAM_STARTUP_RETRY_DELAYS_MS.length; attempt++) {
      const hopGen = this.streamHopOnce(conversation, ollamaTools, temperature);

      try {
        while (true) {
          const next = await hopGen.next();
          if (next.done) return next.value;
          yieldedAny = true;
          yield next.value;
        }
      } catch (error) {
        lastError = error;
        const switchedToNative = this.requestSwitchToNative(error);

        const canRetry =
          !yieldedAny &&
          attempt < STREAM_STARTUP_RETRY_DELAYS_MS.length &&
          (!(error instanceof LocalAiStreamError) || error.retryable) &&
          (switchedToNative || isRetryableStartupError(error));

        if (!canRetry) throw error;

        const delay = STREAM_STARTUP_RETRY_DELAYS_MS[attempt];
        if (delay > 0) await sleep(delay);
      }
    }

    if (lastError) throw lastError;
    return { toolCalls: [], usage: null };
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
      for await (const text of this.streamResponse(systemPrompt, messages, options?.onUsage, {
        temperature: options?.temperature,
      })) {
        yield { kind: "text", text };
      }
      yield { kind: "done", reason: "complete" };
      return;
    }

    const ollamaTools = tools.map(toOllamaTool);
    const conversation: OpenAIMessage[] = toOpenAIMessages(systemPrompt, messages);
    // Accumulated across hops — one final onUsage call for the whole turn,
    // not one per hop. Mirrors GeminiProvider.streamWithTools: input tokens
    // take the latest hop's value (already includes growing history),
    // output tokens sum across hops.
    let accumulated: TokenUsage | null = null;
    let outputChars = 0;

    for (let hop = 0; hop < maxHops; hop++) {
      // Stream one hop. The inner generator yields text strings as they
      // arrive and returns a final summary with collected tool calls.
      const hopGen = this.streamHopWithStartupRetry(conversation, ollamaTools, options?.temperature);
      const accumulatedText: string[] = [];
      let hopResult: HopResult;

      while (true) {
        const next = await hopGen.next();
        if (next.done) {
          hopResult = next.value;
          break;
        }
        accumulatedText.push(next.value);
        outputChars += next.value.length;
        yield { kind: "text", text: next.value };
      }

      accumulated = accumulateHopUsage(accumulated, hopResult.usage);

      if (hopResult.toolCalls.length === 0) {
        options?.onUsage?.(
          accumulated ?? estimatedUsage(inputCharsFor(systemPrompt, messages), outputChars),
        );
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

      // Yield tool_call events synchronously so the UI can paint
      // pending pills immediately (preserves model-emitted order).
      const calls = hopResult.toolCalls.map((call) => ({
        id: call.id,
        name: call.name,
        args: parseToolArguments(call.arguments),
      }));
      for (const c of calls) {
        yield { kind: "tool_call", callId: c.id, name: c.name, args: c.args };
      }

      // Run all handlers in parallel. Single-call hops are unchanged;
      // multi-call hops collapse from sum(durations) to max(durations).
      const handlerResults = await Promise.all(
        calls.map((c) => onToolCall({ name: c.name, args: c.args })),
      );

      for (let i = 0; i < calls.length; i++) {
        const c = calls[i];
        const handlerResult = handlerResults[i];
        yield {
          kind: "tool_result",
          callId: c.id,
          name: c.name,
          status: handlerResult.status,
          summary: handlerResult.summary,
          response: handlerResult.response,
        };
        conversation.push({
          role: "tool",
          tool_call_id: c.id,
          name: c.name,
          content: serializeToolResponseContent(handlerResult.response, handlerResult.summary),
        });
      }
    }

    options?.onUsage?.(
      accumulated ?? estimatedUsage(inputCharsFor(systemPrompt, messages), outputChars),
    );
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
    temperature?: number,
  ): AsyncGenerator<string, HopResult> {
    const openAIBody = {
      model: this.model,
      messages: conversation,
      stream: true,
      tools: ollamaTools,
      max_tokens: this.maxOutputTokens,
      num_ctx: this.numCtx,
      stream_options: { include_usage: true },
      ...this.openAiReasoningParams,
      ...(temperature !== undefined ? { temperature } : {}),
    };
    const nativeBody = {
      model: this.model,
      messages: conversation,
      stream: true,
      tools: ollamaTools,
      ...this.nativeReasoningParams,
      options: {
        num_ctx: this.numCtx,
        num_predict: this.maxOutputTokens,
        ...(temperature !== undefined ? { temperature } : {}),
      },
      keep_alive: OllamaProvider.KEEP_ALIVE,
    };

    const { mode, response } = await this.postChat(
      openAIBody,
      nativeBody,
      OllamaProvider.STREAM_FIRST_BYTE_TIMEOUT_MS,
    );

    if (!response.ok) {
      const message = `Local AI tool stream failed (${response.status})`;
      throw new LocalAiStreamError(message, {
        switchToNative: shouldSwitchToNative(message),
      });
    }
    if (!response.body) throw new Error("Ollama returned empty stream body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolCalls = new Map<number, AccumulatedToolCall>();
    // Native mode doesn't have a stable index per call; use insertion order.
    let nativeIndex = 0;
    let receivedModelPayload = false;
    let reasoningChars = 0;
    let sawTruncation = false;
    let yieldedText = false;
    let usage: TokenUsage | null = null;
    const firstContentDeadlineAt =
      Date.now() + OllamaProvider.FIRST_CONTENT_TIMEOUT_MS;

    while (true) {
      const { done, value } = await this.readStreamChunk(
        reader,
        receivedModelPayload ? null : firstContentDeadlineAt,
      );
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
            return { toolCalls: Array.from(toolCalls.values()), usage };
          }

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

          const parsedUsage = usageFromOpenAI(parsed.usage);
          if (parsedUsage) usage = parsedUsage;

          const choice = parsed.choices?.[0];
          // Reasoning proves the model is alive without being shown to the
          // caller — it must clear the liveness deadline, or a model that
          // reasons for longer than FIRST_CONTENT_TIMEOUT_MS is killed off
          // mid-thought and blamed for being stuck.
          const reasoningDelta = choice?.delta?.reasoning;
          if (reasoningDelta) {
            reasoningChars += reasoningDelta.length;
            receivedModelPayload = true;
          }
          if (isTruncated(choice?.finish_reason)) sawTruncation = true;
          const text = choice?.delta?.content;
          if (text) {
            receivedModelPayload = true;
            yieldedText = true;
            yield text;
          }

          const callDeltas = choice?.delta?.tool_calls;
          if (callDeltas) {
            receivedModelPayload = true;
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
        if (upstreamError) throw new LocalAiStreamError(upstreamError);

        const thinking = parsed.message?.thinking;
        if (thinking) {
          reasoningChars += thinking.length;
          receivedModelPayload = true;
        }

        const text = parsed.message?.content;
        if (text) {
          receivedModelPayload = true;
          yieldedText = true;
          yield text;
        }

        const calls = parsed.message?.tool_calls;
        if (calls) {
          receivedModelPayload = true;
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
          const parsedUsage = usageFromNative(parsed.prompt_eval_count, parsed.eval_count);
          if (parsedUsage) usage = parsedUsage;
          if (isTruncated(parsed.done_reason)) sawTruncation = true;
          this.assertHopProducedSomething({
            yieldedText,
            toolCallCount: toolCalls.size,
            sawTruncation,
            reasoningChars,
          });
          return { toolCalls: Array.from(toolCalls.values()), usage };
        }
      }
    }

    // Drain any final partial line.
    buffer += decoder.decode();
    this.assertHopProducedSomething({
      yieldedText,
      toolCallCount: toolCalls.size,
      sawTruncation,
      reasoningChars,
    });
    return { toolCalls: Array.from(toolCalls.values()), usage };
  }

  /**
   * A hop that produced neither text nor a tool call, and was cut off by the
   * output cap, is the same silent failure as an empty completion: the tool
   * loop would emit done(complete) and the caller would see an empty turn.
   */
  private assertHopProducedSomething(state: {
    yieldedText: boolean;
    toolCallCount: number;
    sawTruncation: boolean;
    reasoningChars: number;
  }): void {
    if (state.yieldedText || state.toolCallCount > 0) return;
    if (!state.sawTruncation) return;
    throw new LocalAiStreamError(
      noVisibleContentError(this.model, this.maxOutputTokens, state.reasoningChars).message,
      { retryable: false, switchToNative: false },
    );
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): Promise<string> {
    const openAIMessages = toOpenAIMessages(systemPrompt, messages);
    const { mode, response } = await this.postChat(
      {
        model: this.model,
        messages: openAIMessages,
        stream: false,
        response_format: { type: "json_object" },
        max_tokens: OllamaProvider.STRUCTURED_MAX_OUTPUT_TOKENS,
        num_ctx: this.numCtx,
        ...this.openAiReasoningParams,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      },
      {
        model: this.model,
        messages: openAIMessages,
        stream: false,
        format: "json",
        ...this.nativeReasoningParams,
        options: {
          num_ctx: this.numCtx,
          num_predict: OllamaProvider.STRUCTURED_MAX_OUTPUT_TOKENS,
          ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        },
        keep_alive: OllamaProvider.KEEP_ALIVE,
      },
    );

    if (!response.ok) {
      throw new Error(`Local AI structured request failed (${response.status})`);
    }

    const data = (await response.json()) as OpenAIChatResponse | NativeChatResponse;
    const text =
      mode === "openai"
        ? (data as OpenAIChatResponse).choices?.[0]?.message?.content ?? ""
        : (data as NativeChatResponse).message?.content ?? "";

    if (onUsage) {
      const usage =
        mode === "openai"
          ? usageFromOpenAI((data as OpenAIChatResponse).usage)
          : usageFromNative(
              (data as NativeChatResponse).prompt_eval_count,
              (data as NativeChatResponse).eval_count,
            );
      onUsage(usage ?? estimatedUsage(inputCharsFor(systemPrompt, messages), text.length));
    }

    this.assertVisibleContent(
      mode,
      data,
      text,
      OllamaProvider.STRUCTURED_MAX_OUTPUT_TOKENS,
    );
    return text;
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
  /** Real usage for this hop when the server reported it; null otherwise. */
  usage: TokenUsage | null;
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
