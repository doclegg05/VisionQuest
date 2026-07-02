import { GoogleGenerativeAI, SchemaType, type FunctionDeclaration, type Part, type Schema, type Tool, type UsageMetadata } from "@google/generative-ai";
import { randomUUID } from "crypto";
import { estimateTokens } from "../llm-usage-estimate";
import type {
  AIProvider,
  ChatMessage,
  OnUsage,
  TokenUsage,
  ToolCallHandler,
  ToolDeclaration,
  ToolParameterSchema,
  ToolStreamEvent,
  ToolStreamOptions,
} from "./types";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
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
    onUsage?: OnUsage,
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
    const text = result.response.text();
    reportUsage(onUsage, result.response.usageMetadata, systemPrompt, messages, text);
    return text;
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
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

    let outputChars = 0;
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        outputChars += text.length;
        yield text;
      }
    }

    const finalResponse = await result.response;
    reportUsage(onUsage, finalResponse.usageMetadata, systemPrompt, messages, undefined, outputChars);
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
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
    const text = result.response.text();
    reportUsage(onUsage, result.response.usageMetadata, systemPrompt, messages, text);
    return text;
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
    // Accumulated across hops — one final onUsage call for the whole turn,
    // not one per hop.
    let accumulated: TokenUsage | null = null;
    let outputChars = 0;

    for (let hop = 0; hop < maxHops; hop++) {
      const result = await chat.sendMessageStream(nextParts);

      // Stream text as it arrives.
      for await (const chunk of result.stream) {
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (typeof part.text === "string" && part.text.length > 0) {
            outputChars += part.text.length;
            yield { kind: "text", text: part.text };
          }
        }
      }

      // After the stream completes, inspect for function calls.
      const finalResponse = await result.response;
      accumulated = accumulateUsage(accumulated, finalResponse.usageMetadata);
      const calls = finalResponse.functionCalls() ?? [];

      if (calls.length === 0) {
        reportUsage(options?.onUsage, accumulated, systemPrompt, messages, undefined, outputChars);
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

    reportUsage(options?.onUsage, accumulated, systemPrompt, messages, undefined, outputChars);
    yield { kind: "done", reason: "max_hops" };
  }
}

/**
 * Accumulates Gemini usageMetadata across tool-loop hops. Each hop's
 * promptTokenCount already includes the growing conversation history, so
 * input tokens take the LATEST hop's value (not a sum) while output tokens
 * sum across hops — that mirrors what a single non-tool call would have
 * reported had the whole exchange happened in one request.
 */
function accumulateUsage(
  prior: TokenUsage | null,
  metadata: UsageMetadata | undefined,
): TokenUsage | null {
  if (!metadata) return prior;
  const priorOutput = prior?.source === "provider" ? prior.outputTokens : 0;
  const inputTokens = metadata.promptTokenCount;
  const outputTokens = priorOutput + metadata.candidatesTokenCount;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: "provider",
  };
}

/** Reports real Gemini usage when present, else falls back to the shared estimator. */
function reportUsage(
  onUsage: OnUsage | undefined,
  metadataOrAccumulated: UsageMetadata | TokenUsage | undefined | null,
  systemPrompt: string,
  messages: ChatMessage[],
  outputText?: string,
  outputCharsOverride?: number,
): void {
  if (!onUsage) return;

  if (metadataOrAccumulated && "source" in metadataOrAccumulated) {
    onUsage(metadataOrAccumulated);
    return;
  }

  if (metadataOrAccumulated) {
    const { promptTokenCount, candidatesTokenCount, totalTokenCount } = metadataOrAccumulated;
    onUsage({
      inputTokens: promptTokenCount,
      outputTokens: candidatesTokenCount,
      // Defensive: the SDK types totalTokenCount as required, but guard
      // against a missing/malformed response rather than propagate undefined.
      totalTokens: totalTokenCount ?? promptTokenCount + candidatesTokenCount,
      source: "provider",
    });
    return;
  }

  const inputChars = systemPrompt.length + messages.reduce((sum, m) => sum + m.content.length, 0);
  const outputChars = outputCharsOverride ?? outputText?.length ?? 0;
  const inputTokens = estimateTokens(inputChars);
  const outputTokens = estimateTokens(outputChars);
  onUsage({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: "estimated",
  });
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
