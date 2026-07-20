import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, SchemaType, type Content, type FunctionDeclaration, type Part, type SafetySetting, type Schema, type Tool, type UsageMetadata } from "@google/generative-ai";
import { randomUUID } from "crypto";
import { estimateTokens } from "../llm-usage-estimate";
import { GEMINI_MODEL as MODEL } from "@/lib/gemini";
import type {
  AIProvider,
  ChatMessage,
  GenerationOptions,
  OnUsage,
  TokenUsage,
  ToolCallHandler,
  ToolDeclaration,
  ToolParameterSchema,
  ToolStreamEvent,
  ToolStreamOptions,
} from "./types";

// Gemini's default harm filters can block legitimate crisis-coaching replies —
// this app serves vulnerable adults and intentionally handles self-harm
// disclosures. Relax the cloud filters to BLOCK_ONLY_HIGH on every generation
// path; the deterministic crisis safety net (988, src/lib/chat/crisis-safety-net.ts)
// is the enforcement layer, not Gemini's classifier.
const SAFETY_SETTINGS: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
];

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  static get modelName(): string {
    return MODEL;
  }

  private getModel(systemInstruction?: string, options?: GenerationOptions) {
    const genAI = new GoogleGenerativeAI(this.apiKey);
    return genAI.getGenerativeModel({
      model: MODEL,
      safetySettings: SAFETY_SETTINGS,
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(options?.temperature !== undefined
        ? { generationConfig: { temperature: options.temperature } }
        : {}),
    });
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): Promise<string> {
    if (messages.length === 0) throw new Error("messages array must not be empty");
    const model = this.getModel(systemPrompt, options);
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
    options?: GenerationOptions,
  ): AsyncGenerator<string> {
    if (messages.length === 0) throw new Error("messages array must not be empty");
    const model = this.getModel(systemPrompt, options);
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
    options?: GenerationOptions,
  ): Promise<string> {
    if (messages.length === 0) throw new Error("messages array must not be empty");
    const genAI = new GoogleGenerativeAI(this.apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: {
        responseMimeType: "application/json",
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
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
      safetySettings: SAFETY_SETTINGS,
      ...(geminiTools.length ? { tools: geminiTools } : {}),
      ...(options?.temperature !== undefined
        ? { generationConfig: { temperature: options.temperature } }
        : {}),
    });

    // The tool loop manages `contents` itself instead of using ChatSession:
    // the SDK's ChatSession silently DROPS a whole exchange from history
    // (console.warn only) when a streamed response fails its isValidResponse
    // check — which a function-call response with an attached empty text part
    // does. The next hop then sends a functionResponse turn with no preceding
    // functionCall turn and the API 400s ("function response turn must come
    // immediately after a function call turn"). Manual contents keep the
    // model's function-call turn verbatim, so hop N+1 is always well-formed.
    const contents: Content[] = messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    }));

    // Accumulated across hops — one final onUsage call for the whole turn,
    // not one per hop.
    let accumulated: TokenUsage | null = null;
    let outputChars = 0;

    for (let hop = 0; hop < maxHops; hop++) {
      const result = await model.generateContentStream({ contents });

      // Stream text as it arrives, keeping every raw part verbatim: the SDK's
      // aggregated response copies only the fields it knows, which strips
      // Gemini 3 thoughtSignature — and resending a functionCall part without
      // its signature is a 400 ("Function call is missing a thought_signature").
      const rawModelParts: Part[] = [];
      for await (const chunk of result.stream) {
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          rawModelParts.push({ ...part });
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

      // Append the model's function-call turn from the raw wire parts, then
      // the function-response turn — the same roles ChatSession would have
      // used, without its lossy validity gate. Drop only parts that carry
      // nothing (empty object, or a lone empty text); a part whose empty text
      // rides alongside a signature stays. Fall back to reconstructing the
      // turn from the parsed calls if no raw parts survived.
      const modelParts = rawModelParts.filter((part) => {
        const keys = Object.keys(part);
        if (keys.length === 0) return false;
        return !(keys.length === 1 && part.text === "");
      });
      contents.push({
        role: "model",
        parts: modelParts.length > 0 ? modelParts : calls.map((call) => ({ functionCall: call })),
      });
      contents.push({ role: "function", parts: responseParts });
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
