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
}

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
