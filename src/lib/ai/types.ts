export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface AIProvider {
  readonly modelName: string;

  generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string>;

  streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string>;

  generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string>;
}

export function validateMessages(messages: ChatMessage[]): void {
  if (messages.length === 0) {
    throw new Error("messages must contain at least one entry");
  }
  const hasUser = messages.some((m) => m.role === "user");
  if (!hasUser) {
    throw new Error("messages must contain at least one entry with role 'user'");
  }
}
