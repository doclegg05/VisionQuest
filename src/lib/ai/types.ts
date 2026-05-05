// src/lib/ai/types.ts

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface AIProvider {
  readonly name: string;

  /** Non-streaming completion. Returns the full response text. */
  generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string>;

  /** Streaming completion. Yields text chunks as they arrive. */
  streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): AsyncGenerator<string>;

  /** Non-streaming completion with JSON output mode enabled. Returns raw JSON string. */
  generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
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

export type AiTask =
  | "legacy"
  | "sage_student_chat"
  | "sage_staff_chat"
  | "sage_post_response"
  | "conversation_summary"
  | "resume_assist"
  | "resume_extract"
  | "public_form_lookup"
  | "public_program_help";

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
