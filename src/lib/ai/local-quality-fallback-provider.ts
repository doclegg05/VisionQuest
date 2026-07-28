import { logger } from "@/lib/logger";
import type {
  AIProvider,
  ChatMessage,
  GenerationOptions,
  LocalRoutingMetadata,
  OnUsage,
  TokenUsage,
  ToolCallHandler,
  ToolDeclaration,
  ToolStreamEvent,
  ToolStreamOptions,
} from "./types";

function assertGemma(model: string, label: string): void {
  if (!/gemma/i.test(model)) {
    throw new Error(`${label} must be a Gemma model.`);
  }
}

async function collect<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

/**
 * Quality-tier provider wrapper.
 *
 * The primary stream is fully buffered. If it fails at startup or after
 * producing chunks, none of those chunks escape; the request is replayed once
 * against the default Gemma and only the completed fallback is released.
 * This makes a quality-model failure an all-or-nothing event from the client
 * perspective and prevents any Qwen/cloud fallback.
 */
export class LocalQualityFallbackProvider implements AIProvider {
  readonly name = "ollama";
  readonly localRouting: LocalRoutingMetadata;

  constructor(
    private readonly primary: AIProvider,
    private readonly fallback: AIProvider,
    qualityModel: string,
    defaultModel: string,
    taskClass: LocalRoutingMetadata["taskClass"],
  ) {
    assertGemma(qualityModel, "Quality model");
    assertGemma(defaultModel, "Fallback model");
    this.localRouting = {
      taskClass,
      requestedTier: "quality",
      selectedTier: "quality",
      model: qualityModel,
      fallbackModel: defaultModel,
      buffersBeforeOutput: true,
    };
  }

  private recordFallback(error: unknown): void {
    logger.warn("local_ai.quality_fallback", {
      qualityModel: this.localRouting.model,
      fallbackModel: this.localRouting.fallbackModel,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): Promise<string> {
    let primaryUsage: TokenUsage | undefined;
    try {
      const response = await this.primary.generateResponse(
        systemPrompt,
        messages,
        (usage) => {
          primaryUsage = usage;
        },
        options,
      );
      if (primaryUsage) onUsage?.(primaryUsage);
      return response;
    } catch (error) {
      this.recordFallback(error);
      return this.fallback.generateResponse(
        systemPrompt,
        messages,
        onUsage,
        options,
      );
    }
  }

  async *streamResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): AsyncGenerator<string> {
    let chunks: string[];
    let chosenUsage: TokenUsage | undefined;
    try {
      chunks = await collect(
        this.primary.streamResponse(
          systemPrompt,
          messages,
          (usage) => {
            chosenUsage = usage;
          },
          options,
        ),
      );
    } catch (error) {
      this.recordFallback(error);
      chosenUsage = undefined;
      chunks = await collect(
        this.fallback.streamResponse(
          systemPrompt,
          messages,
          (usage) => {
            chosenUsage = usage;
          },
          options,
        ),
      );
    }

    if (chosenUsage) onUsage?.(chosenUsage);
    for (const chunk of chunks) yield chunk;
  }

  async generateStructuredResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage?: OnUsage,
    options?: GenerationOptions,
  ): Promise<string> {
    let primaryUsage: TokenUsage | undefined;
    try {
      const response = await this.primary.generateStructuredResponse(
        systemPrompt,
        messages,
        (usage) => {
          primaryUsage = usage;
        },
        options,
      );
      if (primaryUsage) onUsage?.(primaryUsage);
      return response;
    } catch (error) {
      this.recordFallback(error);
      return this.fallback.generateStructuredResponse(
        systemPrompt,
        messages,
        onUsage,
        options,
      );
    }
  }

  async *streamWithTools(
    systemPrompt: string,
    messages: ChatMessage[],
    tools: ToolDeclaration[],
    onToolCall: ToolCallHandler,
    options?: ToolStreamOptions,
  ): AsyncGenerator<ToolStreamEvent> {
    if (!this.primary.streamWithTools || !this.fallback.streamWithTools) {
      for await (const text of this.streamResponse(
        systemPrompt,
        messages,
        options?.onUsage,
        { temperature: options?.temperature },
      )) {
        yield { kind: "text", text };
      }
      yield { kind: "done", reason: "complete" };
      return;
    }

    const toolResults = new Map<
      string,
      Awaited<ReturnType<ToolCallHandler>>
    >();
    const deduplicatingToolHandler: ToolCallHandler = async (call) => {
      const key = `${call.name}:${JSON.stringify(call.args)}`;
      const existing = toolResults.get(key);
      if (existing) return existing;
      const result = await onToolCall(call);
      toolResults.set(key, result);
      return result;
    };

    let events: ToolStreamEvent[];
    let chosenUsage: TokenUsage | undefined;
    try {
      events = await collect(
        this.primary.streamWithTools(
          systemPrompt,
          messages,
          tools,
          deduplicatingToolHandler,
          {
            ...options,
            onUsage: (usage) => {
              chosenUsage = usage;
            },
          },
        ),
      );
    } catch (error) {
      this.recordFallback(error);
      chosenUsage = undefined;
      events = await collect(
        this.fallback.streamWithTools(
          systemPrompt,
          messages,
          tools,
          deduplicatingToolHandler,
          {
            ...options,
            onUsage: (usage) => {
              chosenUsage = usage;
            },
          },
        ),
      );
    }

    if (chosenUsage) options?.onUsage?.(chosenUsage);
    for (const event of events) yield event;
  }
}
