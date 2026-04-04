import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIProvider, ChatMessage } from "./types";

const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const MODEL = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  static get modelName(): string {
    return MODEL;
  }

  private getModel(systemInstruction?: string) {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    return genAI.getGenerativeModel({
      model: MODEL,
      ...(systemInstruction ? { systemInstruction } : {}),
    });
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const model = this.getModel(systemPrompt);
    const chat = model.startChat({
      history: messages.slice(0, -1).map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      })),
    });

    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    return result.response.text();
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): AsyncGenerator<string> {
    const model = this.getModel(systemPrompt);
    const chat = model.startChat({
      history: messages.slice(0, -1).map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      })),
    });

    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessageStream(lastMessage.content);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
  ): Promise<string> {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const chat = model.startChat({
      history: messages.slice(0, -1).map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      })),
    });

    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    return result.response.text();
  }
}
