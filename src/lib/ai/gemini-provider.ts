import { GoogleGenerativeAI, SchemaType, type FunctionDeclaration, type Part, type Schema, type Tool } from "@google/generative-ai";
import { randomUUID } from "crypto";
import type {
  AIProvider,
  ChatMessage,
  ToolCallHandler,
  ToolDeclaration,
  ToolParameterSchema,
  ToolStreamEvent,
  ToolStreamOptions,
} from "./types";

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
    if (messages.length === 0) throw new Error("messages array must not be empty");
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
    if (messages.length === 0) throw new Error("messages array must not be empty");
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
    if (messages.length === 0) throw new Error("messages array must not be empty");
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

  async *streamWithTools(
    systemPrompt: string,
    messages: ChatMessage[],
    tools: ToolDeclaration[],
    onToolCall: ToolCallHandler,
    options?: ToolStreamOptions,
  ): AsyncGenerator<ToolStreamEvent> {
    if (messages.length === 0) throw new Error("messages array must not be empty");
    const maxHops = Math.max(1, options?.maxHops ?? 5);

    const genAI = new GoogleGenerativeAI(this.apiKey);
    const geminiTools: Tool[] = tools.length
      ? [{ functionDeclarations: tools.map(toGeminiFunctionDeclaration) }]
      : [];

    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt,
      ...(geminiTools.length ? { tools: geminiTools } : {}),
    });

    const chat = model.startChat({
      history: messages.slice(0, -1).map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      })),
      ...(geminiTools.length ? { tools: geminiTools } : {}),
    });

    let nextParts: string | Part[] = messages[messages.length - 1].content;

    for (let hop = 0; hop < maxHops; hop++) {
      const result = await chat.sendMessageStream(nextParts);

      // Stream text as it arrives.
      for await (const chunk of result.stream) {
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (typeof part.text === "string" && part.text.length > 0) {
            yield { kind: "text", text: part.text };
          }
        }
      }

      // After the stream completes, inspect for function calls.
      const finalResponse = await result.response;
      const calls = finalResponse.functionCalls() ?? [];

      if (calls.length === 0) {
        yield { kind: "done", reason: "complete" };
        return;
      }

      // Yield tool_call events synchronously (in the order the model
      // emitted them) so the UI can paint pending pills immediately.
      const enriched = calls.map((call) => ({
        callId: randomUUID(),
        name: call.name,
        args: (call.args as Record<string, unknown>) ?? {},
      }));
      for (const c of enriched) {
        yield { kind: "tool_call", callId: c.callId, name: c.name, args: c.args };
      }

      // Run all handlers in parallel. For a single-call hop this is
      // identical to sequential; when the model emits 2+ calls (e.g.,
      // "show me my goals AND my appointments") the wall-clock cost
      // collapses from sum(durations) to max(durations).
      const handlerResults = await Promise.all(
        enriched.map((c) => onToolCall({ name: c.name, args: c.args })),
      );

      const responseParts: Part[] = [];
      for (let i = 0; i < enriched.length; i++) {
        const c = enriched[i];
        const handlerResult = handlerResults[i];
        yield {
          kind: "tool_result",
          callId: c.callId,
          name: c.name,
          status: handlerResult.status,
          summary: handlerResult.summary,
          response: handlerResult.response,
        };
        responseParts.push({
          functionResponse: {
            name: c.name,
            response: serializeFunctionResponse(handlerResult.response, handlerResult.summary),
          },
        });
      }

      nextParts = responseParts;
    }

    yield { kind: "done", reason: "max_hops" };
  }
}

function toGeminiFunctionDeclaration(tool: ToolDeclaration): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: Object.fromEntries(
        Object.entries(tool.parameters.properties).map(([key, schema]) => [
          key,
          toGeminiSchema(schema),
        ]),
      ),
      required: tool.parameters.required ?? [],
    },
  };
}

// Gemini's Schema is a discriminated union with literal `type` values
// per variant. We build the same shape at runtime but TypeScript can't
// narrow through Object.fromEntries, so cast at the seam.
function toGeminiSchema(schema: ToolParameterSchema): Schema {
  const base: Record<string, unknown> = { type: schemaTypeFor(schema.type) };
  if (schema.description) base.description = schema.description;
  if (schema.enum) base.enum = [...schema.enum];
  if (schema.items) base.items = toGeminiSchema(schema.items);
  return base as unknown as Schema;
}

function schemaTypeFor(type: ToolParameterSchema["type"]): SchemaType {
  switch (type) {
    case "string":
      return SchemaType.STRING;
    case "number":
      return SchemaType.NUMBER;
    case "integer":
      return SchemaType.INTEGER;
    case "boolean":
      return SchemaType.BOOLEAN;
    case "array":
      return SchemaType.ARRAY;
    case "object":
      return SchemaType.OBJECT;
  }
}

function serializeFunctionResponse(response: unknown, summary: string): Record<string, unknown> {
  if (response && typeof response === "object" && !Array.isArray(response)) {
    return { ...(response as Record<string, unknown>), _summary: summary };
  }
  return { result: response, _summary: summary };
}
