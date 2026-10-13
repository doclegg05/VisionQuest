/**
 * OpenRouter (https://openrouter.ai) through its OpenAI-compatible chat API.
 *
 * EVAL AND BENCHMARK USE ONLY. Real student data must never reach OpenRouter:
 * its data agreement does not cover education records, and the 2026-09-06
 * FERPA review recommends against it for student data. Nothing under src/
 * may import this file except its own test (eslint.config.mjs,
 * openRouterEvalOnly), and resolveAiProvider never returns it.
 * Design: docs/superpowers/specs/2026-10-13-openrouter-test-bench-design.md.
 */
import { randomUUID } from "crypto";
import { estimateTokens } from "../llm-usage-estimate";
import type {
  AIProvider,
  ChatMessage,
  GenerationOptions,
  OnUsage,
  TokenUsage,
  ToolCallHandler,
  ToolDeclaration,
  ToolStreamEvent,
  ToolStreamOptions,
} from "./types";

export const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api";
export const OPENROUTER_DEFAULT_MODEL = "google/gemini-3.1-flash-lite";

/**
 * Sent on every request, written last so nothing can override it: zero data
 * retention, and only upstream endpoints that neither store nor train on
 * prompts.
 */
export const OPENROUTER_PRIVACY = Object.freeze({ zdr: true, data_collection: "deny" } as const);

/** Same ladder as GeminiProvider: 3 attempts, 500ms then 1500ms. */
const RETRY_DELAYS_MS = [500, 1_500];
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_ESTABLISH_TIMEOUT_MS = 20_000;
const DEFAULT_STREAM_STALL_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_HOPS = 5;
/** Never sent: they identify a person or route content to third-party plugins. */
const FORBIDDEN_BODY_KEYS = new Set(["user", "session_id", "plugins", "provider"]);
const KEY_LIMIT_PATTERN = /key[_\s-]?limit/i;

export type OpenRouterErrorKind = "credits" | "refused" | "rate_limited" | "unavailable" | "bad_request";

export class OpenRouterError extends Error {
  readonly kind: OpenRouterErrorKind;
  readonly status: number | null;

  constructor(message: string, kind: OpenRouterErrorKind, status: number | null = null) {
    super(message);
    this.name = "OpenRouterError";
    this.kind = kind;
    this.status = status;
  }
}

/** The Next.js server sets NEXT_RUNTIME; Render sets RENDER. OpenRouter must run in neither. */
const APP_SERVER_MARKERS = ["NEXT_RUNTIME", "RENDER"] as const;

/**
 * Runtime half of the eval-only rule. The lint guard can be sidestepped by an
 * import shape it does not know; this check cannot, because it runs wherever
 * the provider is constructed.
 */
export function assertNotAppServer(env: NodeJS.ProcessEnv = process.env): void {
  const marker = APP_SERVER_MARKERS.find((name) => Boolean(env[name]?.trim()));
  if (marker) {
    throw new OpenRouterError(
      `OpenRouter is eval-only and refuses to run inside the app server (${marker} is set).`,
      "bad_request",
    );
  }
}

export interface OpenRouterResponseMeta {
  upstreamProvider: string | null;
  model: string | null;
}

export interface OpenRouterProviderOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  streamEstablishTimeoutMs?: number;
  streamStallTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onResponseMeta?: (meta: OpenRouterResponseMeta) => void;
}

interface WireUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type WireMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[]; reasoning_details?: unknown[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface WireDeltaToolCall {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamChunk {
  provider?: unknown;
  model?: unknown;
  error?: unknown;
  usage?: WireUsage | null;
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: WireDeltaToolCall[]; reasoning_details?: unknown[] };
    finish_reason?: string | null;
  }>;
}

interface CompletionJson {
  provider?: unknown;
  model?: unknown;
  usage?: WireUsage | null;
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
}

export interface PartialToolCall {
  id: string | null;
  name: string;
  arguments: string;
}

interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  rawArguments: string;
}

interface HopResult {
  text: string;
  calls: ParsedToolCall[];
  reasoning: unknown[];
  usage: TokenUsage | null;
  finishReason: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** An HTTP failure's kind. The body is read only to spot a key spending limit and never reaches a message. */
export function classifyOpenRouterFailure(status: number, bodyText: string): OpenRouterErrorKind {
  if (status === 402) return "credits";
  if (status === 403) return KEY_LIMIT_PATTERN.test(bodyText) ? "credits" : "refused";
  if (status === 429) return "rate_limited";
  if (status === 408 || status >= 500) return "unavailable";
  return "bad_request";
}

export function buildRequestBody(
  model: string,
  systemPrompt: string,
  messages: readonly WireMessage[],
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const safeExtra = Object.fromEntries(Object.entries(extra).filter(([key]) => !FORBIDDEN_BODY_KEYS.has(key)));
  return {
    ...safeExtra,
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    provider: { ...OPENROUTER_PRIVACY },
  };
}

function toWireMessages(messages: readonly ChatMessage[]): WireMessage[] {
  return messages.map((message) =>
    message.role === "model"
      ? { role: "assistant", content: message.content }
      : { role: "user", content: message.content },
  );
}

function toWireTool(tool: ToolDeclaration) {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

export function mergeToolCallPart(prev: PartialToolCall | undefined, part: WireDeltaToolCall): PartialToolCall {
  return {
    id: prev?.id ?? part.id ?? null,
    name: (prev?.name ?? "") + (part.function?.name ?? ""),
    arguments: (prev?.arguments ?? "") + (part.function?.arguments ?? ""),
  };
}

/**
 * Gemini 2.x models reached through OpenAI-style APIs sometimes name a tool
 * "default_api.<tool>". Strip that prefix only when what remains is a tool we
 * declared, so a comparison judges the model's choice, not its formatting.
 */
const GEMINI_TOOL_NAMESPACE = "default_api.";

export function normalizeToolName(name: string, declared: ReadonlySet<string>): string {
  if (declared.has(name) || !name.startsWith(GEMINI_TOOL_NAMESPACE)) return name;
  const bare = name.slice(GEMINI_TOOL_NAMESPACE.length);
  return declared.has(bare) ? bare : name;
}

/** Boundary parse of a model-written argument string. */
function parseToolCall(call: PartialToolCall): ParsedToolCall {
  const raw = call.arguments.trim();
  let parsed: unknown = {};
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new OpenRouterError(`Tool call "${call.name}" had arguments that were not valid JSON`, "bad_request");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OpenRouterError(`Tool call "${call.name}" had arguments that were not a JSON object`, "bad_request");
  }
  return {
    id: call.id ?? `call_${randomUUID()}`,
    name: call.name,
    args: parsed as Record<string, unknown>,
    rawArguments: raw.length > 0 ? raw : "{}",
  };
}

function toTokenUsage(usage: WireUsage | null | undefined): TokenUsage | null {
  if (!usage || typeof usage.prompt_tokens !== "number" || typeof usage.completion_tokens !== "number") return null;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens ?? usage.prompt_tokens + usage.completion_tokens,
    source: "provider",
  };
}

/** Like GeminiProvider: input is the latest hop's (it already holds the history), output sums. */
function accumulateUsage(prior: TokenUsage | null, next: TokenUsage | null): TokenUsage | null {
  if (!next) return prior;
  const outputTokens = (prior?.outputTokens ?? 0) + next.outputTokens;
  return { inputTokens: next.inputTokens, outputTokens, totalTokens: next.inputTokens + outputTokens, source: "provider" };
}

function reportUsage(
  onUsage: OnUsage | undefined,
  usage: TokenUsage | null,
  systemPrompt: string,
  messages: readonly ChatMessage[],
  outputChars: number,
): void {
  if (!onUsage) return;
  if (usage) {
    onUsage(usage);
    return;
  }
  const inputChars = systemPrompt.length + messages.reduce((sum, message) => sum + message.content.length, 0);
  const inputTokens = estimateTokens(inputChars);
  const outputTokens = estimateTokens(outputChars);
  onUsage({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, source: "estimated" });
}

function metaOf(json: { provider?: unknown; model?: unknown }): OpenRouterResponseMeta {
  return {
    upstreamProvider: typeof json.provider === "string" ? json.provider : null,
    model: typeof json.model === "string" ? json.model : null,
  };
}

function temperatureOf(options?: GenerationOptions | ToolStreamOptions): Record<string, unknown> {
  return options?.temperature !== undefined ? { temperature: options.temperature } : {};
}

function emptyReplyError(finishReason: string | null | undefined): OpenRouterError {
  const reason = finishReason ?? "unknown";
  const kind: OpenRouterErrorKind = reason === "content_filter" ? "refused" : "unavailable";
  return new OpenRouterError(`OpenRouter returned no text (finish_reason: ${reason})`, kind);
}

function assertMessages(messages: readonly ChatMessage[]): void {
  if (messages.length === 0) throw new Error("messages array must not be empty");
}

function serializeToolResponse(response: unknown, summary: string): Record<string, unknown> {
  if (response && typeof response === "object" && !Array.isArray(response)) {
    return { ...(response as Record<string, unknown>), _summary: summary };
  }
  return { result: response, _summary: summary };
}

function transportError(error: unknown, timeoutMs: number): OpenRouterError {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new OpenRouterError(`OpenRouter request timed out after ${timeoutMs}ms`, "unavailable");
  }
  return new OpenRouterError("OpenRouter request failed (network)", "unavailable");
}

function isRetryable(error: unknown): boolean {
  return error instanceof OpenRouterError && (error.kind === "rate_limited" || error.kind === "unavailable");
}

async function failureFromResponse(response: Response): Promise<OpenRouterError> {
  // The body only refines 403 into credits vs refused. If it cannot be read,
  // the status alone still classifies the failure.
  const bodyText = await response.text().catch(() => "");
  const kind = classifyOpenRouterFailure(response.status, bodyText);
  return new OpenRouterError(`OpenRouter request failed (${response.status}, ${kind})`, kind, response.status);
}

/** Boundary parse of a non-streaming reply. */
function parseCompletion(text: string, status: number): CompletionJson {
  try {
    return JSON.parse(text) as CompletionJson;
  } catch {
    throw new OpenRouterError("OpenRouter returned a reply that was not JSON", "unavailable", status);
  }
}

/** Boundary parse of one SSE data line. */
function parseChunk(data: string): StreamChunk {
  try {
    return JSON.parse(data) as StreamChunk;
  } catch {
    throw new OpenRouterError("OpenRouter sent a stream chunk that was not JSON", "unavailable");
  }
}

function errorCodeOf(error: unknown): number | null {
  if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "number") {
    return (error as { code: number }).code;
  }
  return null;
}

/** A stream event that reports an error, classified by its code (credits are not retried). */
function checkChunk(chunk: StreamChunk): StreamChunk {
  if (chunk.error === undefined && chunk.choices?.[0]?.finish_reason !== "error") return chunk;
  const code = errorCodeOf(chunk.error);
  const kind = code === null ? "unavailable" : classifyOpenRouterFailure(code, JSON.stringify(chunk.error));
  throw new OpenRouterError(`OpenRouter reported an error mid-stream${code === null ? "" : ` (${code})`}`, kind, code);
}

/** `data:` payload of one SSE line; null for blank lines and `: comment` keep-alives. */
function sseData(line: string): string | null {
  const trimmed = line.trim();
  return trimmed.startsWith("data:") ? trimmed.slice(5).trim() : null;
}

// ---------------------------------------------------------------------------
// Stream reading
// ---------------------------------------------------------------------------

async function readWithStall(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  stallMs: number,
  controller: AbortController,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new OpenRouterError(`OpenRouter stream stalled for ${stallMs}ms`, "unavailable"));
    }, stallMs);
  });
  try {
    return await Promise.race([reader.read(), stalled]);
  } catch (error) {
    throw error instanceof OpenRouterError ? error : new OpenRouterError("OpenRouter stream failed (network)", "unavailable");
  } finally {
    clearTimeout(timer);
  }
}

async function* readSseChunks(
  response: Response,
  controller: AbortController,
  stallMs: number,
): AsyncGenerator<StreamChunk> {
  if (!response.body) throw new OpenRouterError("OpenRouter stream had no body", "unavailable", response.status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await readWithStall(reader, stallMs, controller);
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        const data = sseData(line);
        if (data === "[DONE]") return;
        if (data !== null && data.length > 0) yield parseChunk(data);
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

async function* runToolCalls(
  calls: readonly ParsedToolCall[],
  onToolCall: ToolCallHandler,
): AsyncGenerator<ToolStreamEvent, WireMessage[]> {
  for (const call of calls) yield { kind: "tool_call", callId: call.id, name: call.name, args: call.args };
  // Parallel, like GeminiProvider: wall clock is the slowest tool, not the sum.
  const results = await Promise.all(
    calls.map((call) => onToolCall({ callId: call.id, name: call.name, args: call.args })),
  );
  for (const [i, call] of calls.entries()) {
    const result = results[i];
    yield {
      kind: "tool_result",
      callId: call.id,
      name: call.name,
      status: result.status,
      summary: result.summary,
      response: result.response,
    };
  }
  return calls.map((call, i) => ({
    role: "tool",
    tool_call_id: call.id,
    content: JSON.stringify(serializeToolResponse(results[i].response, results[i].summary)),
  }));
}

function assistantTurn(hop: HopResult): WireMessage {
  return {
    role: "assistant",
    content: hop.text.length > 0 ? hop.text : null,
    tool_calls: hop.calls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.rawArguments },
    })),
    // Sent back exactly as streamed. Gemini 3 needs its reasoning signature
    // on the next round or the follow-up request fails.
    ...(hop.reasoning.length > 0 ? { reasoning_details: hop.reasoning } : {}),
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class OpenRouterProvider implements AIProvider {
  readonly name = "openrouter";
  readonly model: string;
  private readonly apiKey: string;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly streamEstablishTimeoutMs: number;
  private readonly streamStallTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onResponseMeta?: (meta: OpenRouterResponseMeta) => void;

  constructor(apiKey: string, model: string = OPENROUTER_DEFAULT_MODEL, options: OpenRouterProviderOptions = {}) {
    assertNotAppServer();
    if (!apiKey) throw new OpenRouterError("OPENROUTER_API_KEY is not set", "bad_request");
    this.apiKey = apiKey;
    this.model = model;
    this.url = `${(options.baseUrl ?? OPENROUTER_DEFAULT_BASE).replace(/\/+$/, "")}/v1/chat/completions`;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.streamEstablishTimeoutMs = options.streamEstablishTimeoutMs ?? DEFAULT_STREAM_ESTABLISH_TIMEOUT_MS;
    this.streamStallTimeoutMs = options.streamStallTimeoutMs ?? DEFAULT_STREAM_STALL_TIMEOUT_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onResponseMeta = options.onResponseMeta;
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): Promise<string> {
    return this.completeOnce(systemPrompt, messages, {}, onUsage, options);
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): Promise<string> {
    return this.completeOnce(systemPrompt, messages, { response_format: { type: "json_object" } }, onUsage, options);
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): AsyncGenerator<string> {
    assertMessages(messages);
    const body = buildRequestBody(this.model, systemPrompt, toWireMessages(messages), {
      stream: true,
      ...temperatureOf(options),
    });
    let usage: TokenUsage | null = null;
    let outputChars = 0;
    let finishReason: string | null = null;
    for await (const chunk of this.streamChunks(body)) {
      usage = toTokenUsage(chunk.usage) ?? usage;
      finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
      const text = chunk.choices?.[0]?.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        outputChars += text.length;
        yield text;
      }
    }
    if (outputChars === 0) throw emptyReplyError(finishReason);
    reportUsage(onUsage, usage, systemPrompt, messages, outputChars);
  }

  async *streamWithTools(
    systemPrompt: string,
    messages: ChatMessage[],
    tools: ToolDeclaration[],
    onToolCall: ToolCallHandler,
    options?: ToolStreamOptions,
  ): AsyncGenerator<ToolStreamEvent> {
    assertMessages(messages);
    const maxHops = Math.max(1, options?.maxHops ?? DEFAULT_MAX_HOPS);
    const extra = {
      stream: true,
      ...(tools.length > 0 ? { tools: tools.map(toWireTool) } : {}),
      ...temperatureOf(options),
    };
    const declared = new Set(tools.map((tool) => tool.name));
    let history = toWireMessages(messages);
    let usage: TokenUsage | null = null;
    let outputChars = 0;

    for (let hop = 0; hop < maxHops; hop += 1) {
      const raw = yield* this.streamHop(buildRequestBody(this.model, systemPrompt, history, extra));
      const result = { ...raw, calls: raw.calls.map((call) => ({ ...call, name: normalizeToolName(call.name, declared) })) };
      usage = accumulateUsage(usage, result.usage);
      outputChars += result.text.length;
      if (result.calls.length === 0) {
        if (result.text.length === 0) throw emptyReplyError(result.finishReason);
        reportUsage(options?.onUsage, usage, systemPrompt, messages, outputChars);
        yield { kind: "done", reason: "complete" };
        return;
      }
      const toolTurn = yield* runToolCalls(result.calls, onToolCall);
      history = [...history, assistantTurn(result), ...toolTurn];
    }

    reportUsage(options?.onUsage, usage, systemPrompt, messages, outputChars);
    yield { kind: "done", reason: "max_hops" };
  }

  private async completeOnce(
    systemPrompt: string,
    messages: ChatMessage[],
    extra: Record<string, unknown>,
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): Promise<string> {
    assertMessages(messages);
    const body = buildRequestBody(this.model, systemPrompt, toWireMessages(messages), {
      ...extra,
      ...temperatureOf(options),
    });
    const json = await this.withRetries(() => this.postJson(body));
    this.onResponseMeta?.(metaOf(json));
    const choice = json.choices?.[0];
    const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
    if (text.length === 0) throw emptyReplyError(choice?.finish_reason);
    reportUsage(onUsage, toTokenUsage(json.usage), systemPrompt, messages, text.length);
    return text;
  }

  private async *streamHop(body: Record<string, unknown>): AsyncGenerator<ToolStreamEvent, HopResult> {
    let text = "";
    let reasoning: unknown[] = [];
    let usage: TokenUsage | null = null;
    let finishReason: string | null = null;
    const partials = new Map<number, PartialToolCall>();
    for await (const chunk of this.streamChunks(body)) {
      usage = toTokenUsage(chunk.usage) ?? usage;
      finishReason = chunk.choices?.[0]?.finish_reason ?? finishReason;
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content.length > 0) {
        text += delta.content;
        yield { kind: "text", text: delta.content };
      }
      if (Array.isArray(delta.reasoning_details)) reasoning = [...reasoning, ...delta.reasoning_details];
      for (const part of delta.tool_calls ?? []) partials.set(part.index, mergeToolCallPart(partials.get(part.index), part));
    }
    const calls = [...partials.entries()].sort(([a], [b]) => a - b).map(([, partial]) => parseToolCall(partial));
    return { text, calls, reasoning, usage, finishReason };
  }

  private async *streamChunks(body: Record<string, unknown>): AsyncGenerator<StreamChunk> {
    const { first, rest, controller } = await this.withRetries(() => this.establish(body));
    try {
      this.onResponseMeta?.(metaOf(first));
      yield first;
      for await (const chunk of rest) yield checkChunk(chunk);
    } finally {
      controller.abort();
    }
  }

  /** Request send through the first data chunk. The only part of a stream that is retried. */
  private async establish(
    body: Record<string, unknown>,
  ): Promise<{ first: StreamChunk; rest: AsyncGenerator<StreamChunk>; controller: AbortController }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.streamEstablishTimeoutMs);
    try {
      const response = await this.send(body, controller.signal, this.streamEstablishTimeoutMs);
      const rest = readSseChunks(response, controller, this.streamStallTimeoutMs);
      const first = await rest.next();
      if (first.done) throw new OpenRouterError("OpenRouter stream ended before any data", "unavailable");
      // Inside the retry boundary: nothing has reached the caller yet, so an
      // error in the first event is as safe to retry as a failed request.
      return { first: checkChunk(first.value), rest, controller };
    } catch (error) {
      controller.abort();
      if (timedOut) {
        throw new OpenRouterError(`OpenRouter did not start streaming within ${this.streamEstablishTimeoutMs}ms`, "unavailable");
      }
      throw error instanceof OpenRouterError ? error : transportError(error, this.streamEstablishTimeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  private async postJson(body: Record<string, unknown>): Promise<CompletionJson> {
    const response = await this.send(body, AbortSignal.timeout(this.requestTimeoutMs), this.requestTimeoutMs);
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw transportError(error, this.requestTimeoutMs);
    }
    return parseCompletion(text, response.status);
  }

  private async send(body: Record<string, unknown>, signal: AbortSignal, timeoutMs: number): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw transportError(error, timeoutMs);
    }
    if (!response.ok) throw await failureFromResponse(response);
    return response;
  }

  private async withRetries<T>(attempt: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i += 1) {
      try {
        return await attempt();
      } catch (error) {
        if (!isRetryable(error) || i >= RETRY_DELAYS_MS.length) throw error;
        await this.sleep(RETRY_DELAYS_MS[i]);
      }
    }
  }
}
