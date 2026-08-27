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
      /** Present when the turn ended by calling a tool. */
      tool_calls?: OpenAIToolCallMessage[];
    };
    /**
     * "length" when the model hit the output-token cap mid-generation,
     * "tool_calls" when it ended the turn by calling a tool.
     */
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

/** The clock a single `reader.read()` runs against. */
interface StreamDeadline {
  /** Epoch ms at which the read is abandoned. */
  at: number;
  kind: "first-content" | "stall";
}

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
 * Why a completion came back with no visible text.
 *
 * `unknown` is a real answer, not a gap: native /api/chat reports NOTHING
 * when a model calls a tool the request never declared, so on that surface
 * the cause genuinely is not observable. Naming it keeps the error honest.
 */
type EmptyCompletionCause =
  | { kind: "truncated"; reasoningChars: number }
  | { kind: "tool_call"; toolName: string | null }
  | { kind: "unknown" };

/**
 * Classifies an empty completion from whatever the surface admits.
 *
 * The two surfaces admit different amounts. `/v1/chat/completions` reports
 * `finish_reason: "tool_calls"` and may carry the parsed call; native
 * `/api/chat` carries `message.tool_calls` only when the caller declared
 * tools, and is silent otherwise. Checked in that order because a turn cut
 * off by the output cap is a budget problem regardless of what else it was
 * doing.
 */
function classifyEmptyCompletion(
  mode: Exclude<OllamaApiMode, "unknown">,
  data: OpenAIChatResponse | NativeChatResponse,
): EmptyCompletionCause {
  if (mode === "openai") {
    const choice = (data as OpenAIChatResponse).choices?.[0];
    if (isTruncated(choice?.finish_reason)) {
      return { kind: "truncated", reasoningChars: (choice?.message?.reasoning ?? "").length };
    }
    const calls = choice?.message?.tool_calls ?? [];
    if (choice?.finish_reason === "tool_calls" || calls.length > 0) {
      return { kind: "tool_call", toolName: calls[0]?.function?.name ?? null };
    }
    return { kind: "unknown" };
  }

  const native = data as NativeChatResponse;
  if (isTruncated(native.done_reason)) {
    return { kind: "truncated", reasoningChars: (native.message?.thinking ?? "").length };
  }
  const calls = native.message?.tool_calls ?? [];
  if (calls.length > 0) {
    return { kind: "tool_call", toolName: calls[0]?.function?.name ?? null };
  }
  return { kind: "unknown" };
}

/**
 * Builds the error thrown when a turn ends by calling a tool and says nothing.
 *
 * The model routed the question to a tool the request never offered, so the
 * call was dropped and the reply is empty. This is the bug class that cost
 * two debugging sessions: the fix is either to declare the tool or to tell
 * the model it has none, never to pass the "" along.
 */
function toolCallWithoutContentError(model: string, toolName: string | null): Error {
  const named = toolName ? ` (${toolName})` : "";
  return new Error(
    `Local AI model "${model}" ended its turn with a tool call${named} and no visible content.` +
      ` The request declared no matching tool, so the call was dropped and nothing was left to say.` +
      ` Declare the tool, or state in the prompt that this call has none.`,
  );
}

/**
 * Builds the error thrown when a turn is empty and the surface says why.
 *
 * Deliberately claims no cause. Native /api/chat with no tools declared
 * returns `{"role":"assistant","content":""}` with `done_reason: "stop"` for
 * a dropped tool call — the same bytes it returns for any other empty turn —
 * so guessing here would send the next reader down the wrong path.
 */
function emptyCompletionError(model: string): Error {
  return new Error(
    `Local AI model "${model}" returned an empty reply and the turn ended normally.` +
      ` This API surface reports no cause: Ollama's native /api/chat is silent when a model calls a tool the request never declared.` +
      ` Diagnose with /api/generate raw:true, which shows the literal emitted tokens.`,
  );
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
  /**
   * The model tag actually serving this instance.
   *
   * Public because the usage ledger has to record WHICH model served a call,
   * not just which provider class. With per-role models that distinction is
   * the whole point: a ledger that stores "ollama" for every row cannot answer
   * "is the extract model keeping up?" — the question roles exist to let an
   * operator ask. Mirrors `OllamaEmbeddingProvider.model`, which is already
   * public for the same reason.
   */
  readonly model: string;
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

  /**
   * Time allowed between model deltas once the stream is producing.
   *
   * An inter-DELTA clock, not an inter-chunk one: the relay keeps sending
   * heartbeat frames while a wedged model emits nothing, so only content,
   * reasoning, or a tool-call delta may reset it. Roomier than the
   * first-content window because a mid-reply pause on loaded CPU hardware is
   * normal where a stalled start is not.
   */
  private static readonly STREAM_STALL_TIMEOUT_MS = 60_000;

  private static readonly DEFAULT_MAX_OUTPUT_TOKENS = 768;
  private static readonly STRUCTURED_MAX_OUTPUT_TOKENS = 512;

  /**
   * How long Ollama should keep the model resident after a request.
   * Set to 8h to cover the SPOKES workday (7:30 AM – 3:30 PM) so the model
   * stays warm between messages instead of unloading after each idle gap.
   * Pair with the "Sage Model Warmup" scheduled task to pre-load on login.
   *
   * REACHES THE SERVER ONLY ON THE NATIVE SURFACE. Ollama's OpenAI-compatible
   * /v1/chat/completions ignores `keep_alive` (ollama/ollama#11458), and
   * `postChat` tries /v1 first, so on a stock Ollama this value is inert
   * unless the instance is pinned to native — see `pinnedToNativeForKeepAlive`.
   * Residency there is governed by the host's OLLAMA_KEEP_ALIVE instead.
   */
  private static readonly KEEP_ALIVE = "8h";

  /**
   * Keep-alive for a model that is NOT the interactive chat model.
   *
   * Ollama holds every model it has served resident for the full keep-alive,
   * so once roles can point at different models the workday-length default
   * turns each background role into a standing claim on unified memory —
   * exactly the starvation documented in .claude/MEMORY.md, where a resident
   * large model pushed the next model's calls into the 300s timeout and
   * inverted an A/B result. Five minutes covers a burst of background work
   * (a chat turn's extractions all fire together) and then gives the memory
   * back.
   */
  static readonly SECONDARY_KEEP_ALIVE = "5m";

  private readonly keepAlive: string;
  /**
   * True when this instance was given an explicit keep-alive and must
   * therefore talk to /api/chat, the only surface that applies it.
   *
   * The cost is real and worth stating: the native surface hides
   * `finish_reason`, so a turn that ends in an undeclared tool call comes back
   * as an empty string with no signal (see .claude/MEMORY.md). That is
   * acceptable for the background roles this applies to — their prompts
   * advertise no tools — and `done_reason: "length"` still surfaces
   * truncation, which is the failure mode those roles actually hit.
   */
  private readonly pinnedToNativeForKeepAlive: boolean;
  private readonly structuredMaxOutputTokens: number;

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
  private readonly streamStallTimeoutMs: number;

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
    const explicitStallTimeout = structuredConfig?.streamStallTimeoutMs;
    this.streamStallTimeoutMs =
      typeof explicitStallTimeout === "number" && explicitStallTimeout > 0
        ? explicitStallTimeout
        : OllamaProvider.STREAM_STALL_TIMEOUT_MS;
    const explicitKeepAlive = structuredConfig?.keepAlive?.trim();
    this.keepAlive = explicitKeepAlive || OllamaProvider.KEEP_ALIVE;
    // A caller that asked for a specific residency gets the only surface that
    // honors it. /v1 silently drops `keep_alive`, which would leave a
    // background role's model resident on the host default and holding memory
    // against the model students are waiting on — the starvation this option
    // exists to prevent. Skipped for `apiStyle: "openai"` endpoints (LM Studio,
    // vLLM), which have no /api/chat at all and no residency semantics to fix.
    this.pinnedToNativeForKeepAlive = Boolean(explicitKeepAlive) && !this.openAiOnly;
    if (this.pinnedToNativeForKeepAlive) {
      this.apiMode = "native";
    }
    const explicitStructuredMax = structuredConfig?.structuredMaxOutputTokens;
    this.structuredMaxOutputTokens =
      typeof explicitStructuredMax === "number" && explicitStructuredMax > 0
        ? explicitStructuredMax
        : OllamaProvider.STRUCTURED_MAX_OUTPUT_TOKENS;
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
        keep_alive: this.keepAlive,
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
   * Fail loudly on a completion with no visible text, whatever the cause.
   *
   * Empty is never a valid answer here. Every caller either shows the string
   * to a student (chat send's non-streaming path emits it as a text event and
   * persists it), stores it (conversation summaries overwrite a real summary
   * with ""), or JSON.parses it (every structured extractor, where "" throws
   * a SyntaxError logged as a malformed response — fatal already, just
   * misattributed). The one caller that tolerates "" is the warmup ping,
   * which discards the value and already swallows errors.
   *
   * Truncated-but-present content is still usable and passes through; only
   * the all-or-nothing case throws.
   */
  private assertVisibleContent(
    mode: Exclude<OllamaApiMode, "unknown">,
    data: OpenAIChatResponse | NativeChatResponse,
    text: string,
    budget: number,
  ): void {
    if (text) return;

    const cause = classifyEmptyCompletion(mode, data);
    switch (cause.kind) {
      case "truncated":
        throw noVisibleContentError(this.model, budget, cause.reasoningChars);
      case "tool_call":
        throw toolCallWithoutContentError(this.model, cause.toolName);
      case "unknown":
        throw emptyCompletionError(this.model);
    }
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
        keep_alive: this.keepAlive,
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
    /** When the model last proved it was alive. Null until its first delta. */
    let lastDeltaAt: number | null = null;
    const noteDelta = (): void => {
      lastDeltaAt = Date.now();
    };

    while (true) {
      const { done, value } = await this.readStreamChunk(
        reader,
        this.nextStreamDeadline(firstContentDeadlineAt, lastDeltaAt),
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
            const thinking = nativeParsed.message?.thinking;
            if (thinking) {
              reasoningChars += thinking.length;
              noteDelta();
            }
            const content = nativeParsed.message?.content;
            if (content) {
              yieldedContent = true;
              noteDelta();
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
          const reasoningDelta = parsed.choices?.[0]?.delta?.reasoning;
          if (reasoningDelta) {
            reasoningChars += reasoningDelta.length;
            noteDelta();
          }
          if (isTruncated(parsed.choices?.[0]?.finish_reason)) sawTruncation = true;
          const content = streamChunkContent(parsed);
          if (content) {
            yieldedContent = true;
            noteDelta();
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
        const thinking = parsed.message?.thinking;
        if (thinking) {
          reasoningChars += thinking.length;
          noteDelta();
        }
        const content = parsed.message?.content;
        if (content) {
          yieldedContent = true;
          noteDelta();
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

  /**
   * The clock on a live stream. Before the model's first delta it is the
   * first-content window; after it, the inter-delta stall window. There is
   * never a bare read: an unclocked `reader.read()` is what let one token
   * followed by silence hold a turn open indefinitely.
   */
  private nextStreamDeadline(
    firstContentDeadlineAt: number,
    lastDeltaAt: number | null,
  ): StreamDeadline {
    return lastDeltaAt === null
      ? { at: firstContentDeadlineAt, kind: "first-content" }
      : { at: lastDeltaAt + this.streamStallTimeoutMs, kind: "stall" };
  }

  /**
   * Error for a breached stream deadline.
   *
   * The stall variant says "timed out" on purpose: `isRetryableStartupError`
   * matches that word, so a stall that happened before anything was yielded
   * (a tool hop, say) gets the startup retry, while one after yielded output
   * is refused by the `!yieldedAny` guard that would otherwise duplicate it.
   * A first-content breach stays non-retryable, as it was.
   */
  private streamDeadlineError(kind: StreamDeadline["kind"]): LocalAiStreamError {
    if (kind === "stall") {
      return new LocalAiStreamError(
        `Local AI stream timed out after ${Math.round(
          this.streamStallTimeoutMs / 1000,
        )} seconds with no new content from the model.`,
        { retryable: true },
      );
    }
    return new LocalAiStreamError(
      `Local AI did not produce a first content token within ${Math.round(
        OllamaProvider.FIRST_CONTENT_TIMEOUT_MS / 1000,
      )} seconds.`,
      { retryable: false },
    );
  }

  private async readStreamChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    deadline: StreamDeadline,
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    const cancelReason =
      deadline.kind === "stall"
        ? "Local AI stream stalled"
        : "Local AI first content timeout";

    const remainingMs = deadline.at - Date.now();
    if (remainingMs <= 0) {
      await reader.cancel(cancelReason).catch(() => undefined);
      throw this.streamDeadlineError(deadline.kind);
    }

    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            // Reject BEFORE cancelling. Cancelling resolves the pending
            // read with `{ done: true }`, which would win the race and end
            // the stream silently — the deadline would look enforced while
            // the caller got a truncated reply and no error.
            reject(this.streamDeadlineError(deadline.kind));
            void reader.cancel(cancelReason).catch(() => undefined);
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
      keep_alive: this.keepAlive,
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
    let reasoningChars = 0;
    let sawTruncation = false;
    let yieldedText = false;
    let usage: TokenUsage | null = null;
    const firstContentDeadlineAt =
      Date.now() + OllamaProvider.FIRST_CONTENT_TIMEOUT_MS;
    /** When the model last proved it was alive. Null until its first delta. */
    let lastDeltaAt: number | null = null;
    const noteDelta = (): void => {
      lastDeltaAt = Date.now();
    };

    while (true) {
      const { done, value } = await this.readStreamChunk(
        reader,
        this.nextStreamDeadline(firstContentDeadlineAt, lastDeltaAt),
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
            noteDelta();
          }
          if (isTruncated(choice?.finish_reason)) sawTruncation = true;
          const text = choice?.delta?.content;
          if (text) {
            noteDelta();
            yieldedText = true;
            yield text;
          }

          const callDeltas = choice?.delta?.tool_calls;
          if (callDeltas) {
            noteDelta();
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
          noteDelta();
        }

        const text = parsed.message?.content;
        if (text) {
          noteDelta();
          yieldedText = true;
          yield text;
        }

        const calls = parsed.message?.tool_calls;
        if (calls) {
          noteDelta();
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
        max_tokens: this.structuredMaxOutputTokens,
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
          num_predict: this.structuredMaxOutputTokens,
          ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        },
        keep_alive: this.keepAlive,
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
      this.structuredMaxOutputTokens,
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
