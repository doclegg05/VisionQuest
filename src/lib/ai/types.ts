// src/lib/ai/types.ts

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
  /**
   * Present only when the opt-in local task router selected a concrete model.
   * Callers use this metadata to enforce payload minimization; provider
   * selection remains authoritative in the router.
   */
  readonly localRouting?: LocalRoutingMetadata;

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
 * structured result that gets fed back to the model.
 */
export type ToolCallHandler = (call: {
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
  | "deidentified"
  | "public_program"
  | "system";

export type LocalTaskClass =
  | "casual_chat"
  | "student_coaching"
  | "crisis_safety"
  | "structured_extraction"
  | "rag_grounded_answer"
  | "sensitive_coaching"
  | "staff_workflow"
  | "complex_structured"
  | "uncertain";

export interface LocalRoutingContext {
  /** True only when this request did not name or continue a conversation. */
  newConversation: boolean;
  /** Conservative signal: an existing conversation may contain protected history. */
  hasHistory: boolean;
  /** True when retrieved/program grounding will be included in the model payload. */
  hasRag: boolean;
  /** True when a user-uploaded file or derived gist will be included. */
  hasAttachments: boolean;
  /** True for crisis/safety signals, even if the user text also looks casual. */
  hasCrisisState: boolean;
  /** True for teacher/admin/coordinator or staff-derived student context. */
  hasStaffContext: boolean;
  /** False for ambiguous, prompt-injection-like, or otherwise uncertain input. */
  classificationCertain: boolean;
  /** True only when the caller guarantees a generic prompt plus this one turn. */
  minimalContext: boolean;
}

export interface LocalRoutingMetadata {
  taskClass: LocalTaskClass;
  requestedTier: "speed" | "default" | "quality";
  selectedTier: "speed" | "default" | "quality";
  model: string;
  fallbackModel: string | null;
  /** Quality responses are fully buffered before any caller-visible output. */
  buffersBeforeOutput: boolean;
}

export interface AIProviderRequest {
  studentId: string;
  task: AiTask;
  sensitivity: DataSensitivity;
  /**
   * Optional deterministic classification supplied by a trusted caller.
   * The router independently enforces task/sensitivity eligibility, so this
   * cannot opt staff, public, or non-chat work into the Qwen speed path.
   */
  localTaskClass?: LocalTaskClass;
  /**
   * Sensitivity of the exact payload sent to a locally selected model. This
   * never changes the request's authoritative sensitivity or cloud policy.
   */
  localPayloadSensitivity?: DataSensitivity;
  /**
   * Trusted, conservative context signals. Missing fields fail closed to a
   * Gemma tier; they can never broaden cloud eligibility.
   */
  localRoutingContext?: LocalRoutingContext;
  /**
   * Public, non-student tasks may prefer the cloud provider for latency.
   * Sensitive tasks ignore this and remain local-only.
   */
  preferCloud?: boolean;
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
