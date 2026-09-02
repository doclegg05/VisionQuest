// src/lib/ai/types.ts

// Type-only, so this is erased at compile time and no runtime cycle exists
// with roles.ts (which imports AiTask from here).
import type { AiRole } from "./roles";

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

/**
 * Normalized token-usage record for a single provider call. Providers report
 * real counts from the SDK/API response when available (`source: "provider"`)
 * and fall back to the shared char/4 estimator otherwise
 * (`source: "estimated"`) — see src/lib/llm-usage-estimate.ts.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: "provider" | "estimated";
}

/**
 * Optional callback invoked once a generation/stream completes with the
 * observed token usage. Non-breaking: existing callers that don't pass it
 * see no behavior change.
 */
export type OnUsage = (usage: TokenUsage) => void;

/**
 * Optional sampling temperature override. Undefined means "use the
 * provider's default" — production call sites never pass this, so
 * behavior there is unchanged. Exists so deterministic eval harnesses can
 * pin temperature (typically 0) to reduce phrasing variance across runs.
 */
export interface GenerationOptions {
  temperature?: number;
}

export interface AIProvider {
  readonly name: string;

  /** Non-streaming completion. Returns the full response text. */
  generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): Promise<string>;

  /** Streaming completion. Yields text chunks as they arrive. */
  streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): AsyncGenerator<string>;

  /** Non-streaming completion with JSON output mode enabled. Returns raw JSON string. */
  generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): Promise<string>;

  /**
   * Streaming completion with function-calling support. Provider drives the
   * tool-call loop internally — the caller supplies an `onToolCall` callback
   * that runs the tool server-side and returns the result. Provider yields
   * neutral events the agent loop can translate into SSE.
   *
   * Optional. Providers that haven't implemented it should leave undefined;
   * the agent loop will fall back to plain `streamResponse`.
   */
  streamWithTools?(
    systemPrompt: string,
    messages: ChatMessage[],
    tools: ToolDeclaration[],
    onToolCall: ToolCallHandler,
    options?: ToolStreamOptions,
  ): AsyncGenerator<ToolStreamEvent>;
}

/** Provider-neutral tool declaration. Mirrors Gemini's FunctionDeclaration. */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameterSchema>;
    required?: string[];
  };
}

export interface ToolParameterSchema {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: ReadonlyArray<string>;
  items?: ToolParameterSchema;
}

export interface ToolStreamOptions {
  /** Hard cap on round-trip tool calls. Default 5. */
  maxHops?: number;
  /**
   * Invoked once with the ACCUMULATED usage across all hops after the tool
   * loop finishes (not once per hop) — see providers' streamWithTools impls.
   */
  onUsage?: OnUsage;
  /** Optional sampling temperature override — see GenerationOptions. */
  temperature?: number;
}

/**
 * Caller-supplied callback that actually runs the tool. Should return the
 * structured result that gets fed back to the model. `callId` is the same id
 * the surrounding tool_call / tool_result events carry, so the caller can key
 * its own records by it — parallel handlers complete in any order.
 */
export type ToolCallHandler = (call: {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}) => Promise<{ response: unknown; summary: string; status: "success" | "error" }>;

export type ToolStreamEvent =
  | { kind: "text"; text: string }
  | {
      kind: "tool_call";
      callId: string;
      name: string;
      args: Record<string, unknown>;
    }
  | {
      kind: "tool_result";
      callId: string;
      name: string;
      status: "success" | "error";
      summary: string;
      response: unknown;
    }
  | { kind: "done"; reason: "complete" | "max_hops" };

export type AIProviderType = "cloud" | "local";
export type LocalAIAuthMode = "none" | "bearer" | "cloudflare_service_token";
export type PromptTier = "full" | "compact";
/**
 * "ollama" (default): probe/fall back between native /api/* and
 * OpenAI-compatible /v1/* endpoints, same as always.
 * "openai": the endpoint is a generic OpenAI-compatible server (LM Studio,
 * vLLM, llama.cpp server) that only exposes /v1/* — native /api/* calls
 * must never be attempted, including as a fallback.
 */
export type LocalAiApiStyle = "ollama" | "openai";

export type AiTask =
  | "legacy"
  | "sage_student_chat"
  | "sage_staff_chat"
  | "sage_post_response"
  | "sage_briefing"
  | "conversation_summary"
  | "resume_assist"
  | "resume_extract"
  | "tailor_application"
  | "public_form_lookup"
  | "public_program_help"
  | "chat_file_gist";

export type DataSensitivity =
  | "configured"
  | "student_record"
  | "staff_entered"
  | "public_program"
  | "system";

export interface AIProviderRequest {
  studentId: string;
  task: AiTask;
  sensitivity: DataSensitivity;
  /**
   * Public, non-student tasks may prefer the cloud provider for latency.
   * Sensitive tasks ignore this and remain local-only.
   */
  preferCloud?: boolean;
  /**
   * Override the AI role this call belongs to. Defaults to the role its
   * `task` maps to (src/lib/ai/roles.ts), which is right for every call site
   * today. Set it explicitly when one task covers work with genuinely
   * different capability needs — e.g. a prose generation filed under a task
   * whose other call sites all emit strict JSON.
   *
   * Affects only WHICH local model serves the call. It cannot change the
   * FERPA provider decision, which keys off `sensitivity` alone.
   */
  role?: AiRole;
}

export interface LocalAIAuthConfig {
  authMode: LocalAIAuthMode;
  apiKey?: string | null;
  cloudflareAccessClientId?: string | null;
  cloudflareAccessClientSecret?: string | null;
  /**
   * Override Ollama's num_ctx (KV-cache window size). Defaults to the
   * provider's built-in fallback when undefined. Bounded by the caller.
   */
  numCtx?: number;
  /** Defaults to "ollama" when undefined (existing dual-mode behavior). */
  apiStyle?: LocalAiApiStyle;
  /**
   * Let a reasoning ("thinking") model emit its reasoning channel.
   *
   * Defaults to FALSE. Reasoning tokens are drawn from the same output
   * budget as the visible reply, so on a long system prompt a thinking
   * model can spend the entire budget reasoning and return nothing — see
   * the thinking-model regression suite. Turning this on generally needs
   * `maxOutputTokens` raised to match.
   */
  reasoning?: boolean;
  /**
   * Override the per-request output-token cap (num_predict / max_tokens).
   * Defaults to the provider's built-in fallback. Bounded by the caller.
   */
  maxOutputTokens?: number;
  /**
   * Override how long a live stream may go without a model delta before the
   * provider cancels it. Defaults to the provider's built-in fallback.
   */
  streamStallTimeoutMs?: number;
  /**
   * Override Ollama's `keep_alive` (how long the model stays resident after
   * a request). Defaults to the provider's workday-length default, which is
   * right for the interactive chat model and wrong for every other one:
   * Ollama keeps EVERY touched model resident for the full keep-alive, so a
   * background role running a second model holds unified memory against the
   * model students are waiting on. Measured consequence of not doing this is
   * in .claude/MEMORY.md ("keep-alive 8h starves other models").
   */
  keepAlive?: string;
  /**
   * Override the output cap used by `generateStructuredResponse` (JSON mode).
   *
   * Separate from `maxOutputTokens` on purpose. The structured path has always
   * used its own smaller constant and has never honored the global cap, so
   * folding the two together would silently change every deployment that had
   * raised the global one (typically to make room for reasoning tokens on the
   * free-text path). Only a per-role cap sets this, so an operator who has set
   * nothing sees exactly the previous behavior.
   */
  structuredMaxOutputTokens?: number;
}

export interface AIProviderConfig {
  type: AIProviderType;
  /** Ollama server URL (e.g. "https://llm.example.com" or "http://localhost:11434") */
  url?: string;
  /** Model name for Ollama (e.g. "gemma4:26b") */
  model?: string;
  /** Authentication mode for the local AI endpoint. */
  authMode?: LocalAIAuthMode;
}
