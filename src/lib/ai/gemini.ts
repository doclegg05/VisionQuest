import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIProvider, ChatMessage } from "./types";
import { validateMessages } from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
export const GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

export class GeminiProvider implements AIProvider {
  readonly modelName: string;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.modelName = GEMINI_MODEL;
  }

  private getModel(systemInstruction?: string) {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    return genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      ...(systemInstruction ? { systemInstruction } : {}),
    });
  }

  private toHistory(messages: ChatMessage[]) {
    return messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    }));
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    validateMessages(messages);
    const model = this.getModel(systemPrompt);
    const chat = model.startChat({
      history: this.toHistory(messages.slice(0, -1)),
    });
    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    return result.response.text();
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    validateMessages(messages);
    const model = this.getModel(systemPrompt);
    const chat = model.startChat({
      history: this.toHistory(messages.slice(0, -1)),
    });
    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessageStream(lastMessage.content);

    for await (const chunk of result.stream) {
      if (signal?.aborted) break;
      const text = chunk.text();
      if (text) yield text;
    }
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    validateMessages(messages);
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: systemPrompt,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });
    const chat = model.startChat({
      history: this.toHistory(messages.slice(0, -1)),
    });
    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    return result.response.text();
  }
}
