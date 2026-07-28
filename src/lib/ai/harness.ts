import { logger } from "@/lib/logger";
import { estimateTokens } from "@/lib/llm-usage-estimate";
import type {
  AIProvider,
  ChatMessage,
  GenerationOptions,
  OnUsage,
  ToolCallHandler,
  ToolDeclaration,
  ToolStreamEvent,
  ToolStreamOptions,
} from "./types";

export type AiCallPriority = "foreground" | "background";

export interface PromptBudgetTelemetry {
  maxInputTokens: number;
  estimatedInputTokens: number;
  systemTokens: number;
  messageTokens: number;
  currentMessageTokens: number;
  droppedMessages: number;
  duplicateCurrentMessagesRemoved: number;
  overBudget: boolean;
}

export interface PreparedPrompt {
  systemPrompt: string;
  messages: ChatMessage[];
  telemetry: PromptBudgetTelemetry;
}

export interface PreparePromptInput {
  systemPrompt: string;
  history: ChatMessage[];
  currentUserMessage: string;
  maxInputTokens: number;
}

export const COMPACT_PROMPT_INPUT_TOKEN_BUDGET = 7_000;
export const FULL_PROMPT_INPUT_TOKEN_BUDGET = 28_000;

function messageTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (total, message) => total + estimateTokens(message.content.length),
    0,
  );
}

/**
 * Builds the provider payload once and measures the complete prompt:
 * system instruction + retained history + exactly one current user turn.
 */
export function preparePrompt(input: PreparePromptInput): PreparedPrompt {
  const history = input.history.slice();
  let duplicateCurrentMessagesRemoved = 0;

  while (
    history.at(-1)?.role === "user" &&
    history.at(-1)?.content === input.currentUserMessage
  ) {
    history.pop();
    duplicateCurrentMessagesRemoved += 1;
  }

  const systemTokens = estimateTokens(input.systemPrompt.length);
  const currentMessageTokens = estimateTokens(input.currentUserMessage.length);
  let droppedMessages = 0;
  let retainedHistoryTokens = messageTokens(history);

  while (
    systemTokens + retainedHistoryTokens + currentMessageTokens >
      input.maxInputTokens &&
    history.length > 0
  ) {
    const dropped = history.shift();
    retainedHistoryTokens -= estimateTokens(dropped?.content.length ?? 0);
    droppedMessages += 1;
  }

  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: input.currentUserMessage },
  ];
  const totalMessageTokens = retainedHistoryTokens + currentMessageTokens;
  const estimatedInputTokens = systemTokens + totalMessageTokens;

  return {
    systemPrompt: input.systemPrompt,
    messages,
    telemetry: {
      maxInputTokens: input.maxInputTokens,
      estimatedInputTokens,
      systemTokens,
      messageTokens: totalMessageTokens,
      currentMessageTokens,
      droppedMessages,
      duplicateCurrentMessagesRemoved,
      overBudget: estimatedInputTokens > input.maxInputTokens,
    },
  };
}

interface AdmissionOptions {
  maxConcurrent: number;
  maxBackgroundConcurrent: number;
  reservedForeground: number;
}

interface QueuedAdmission {
  priority: AiCallPriority;
  enqueuedAt: number;
  resolve: (lease: AiAdmissionLease) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export interface AiAdmissionLease {
  queueWaitMs: number;
  release(): void;
}

export interface AiAdmissionSnapshot {
  activeForeground: number;
  activeBackground: number;
  queuedForeground: number;
  queuedBackground: number;
}

function abortError(signal?: AbortSignal): Error {
  const reason =
    typeof signal?.reason === "string"
      ? signal.reason
      : "AI request was cancelled.";
  return new DOMException(reason, "AbortError");
}

export class AiAdmissionController {
  private readonly options: AdmissionOptions;
  private activeForeground = 0;
  private activeBackground = 0;
  private readonly foregroundQueue: QueuedAdmission[] = [];
  private readonly backgroundQueue: QueuedAdmission[] = [];

  constructor(options: AdmissionOptions) {
    if (options.maxConcurrent < 1) {
      throw new Error("maxConcurrent must be at least 1");
    }
    if (
      options.maxBackgroundConcurrent < 0 ||
      options.maxBackgroundConcurrent > options.maxConcurrent
    ) {
      throw new Error("maxBackgroundConcurrent is outside the concurrency limit");
    }
    if (
      options.reservedForeground < 0 ||
      options.reservedForeground > options.maxConcurrent
    ) {
      throw new Error("reservedForeground is outside the concurrency limit");
    }
    this.options = options;
  }

  snapshot(): AiAdmissionSnapshot {
    return {
      activeForeground: this.activeForeground,
      activeBackground: this.activeBackground,
      queuedForeground: this.foregroundQueue.length,
      queuedBackground: this.backgroundQueue.length,
    };
  }

  acquire(
    priority: AiCallPriority,
    signal?: AbortSignal,
  ): Promise<AiAdmissionLease> {
    if (signal?.aborted) return Promise.reject(abortError(signal));

    return new Promise<AiAdmissionLease>((resolve, reject) => {
      const queued: QueuedAdmission = {
        priority,
        enqueuedAt: Date.now(),
        resolve,
        reject,
        signal,
      };
      queued.onAbort = () => {
        const queue =
          priority === "foreground"
            ? this.foregroundQueue
            : this.backgroundQueue;
        const index = queue.indexOf(queued);
        if (index >= 0) queue.splice(index, 1);
        reject(abortError(signal));
      };
      signal?.addEventListener("abort", queued.onAbort, { once: true });

      if (priority === "foreground") {
        this.foregroundQueue.push(queued);
      } else {
        this.backgroundQueue.push(queued);
      }
      this.drain();
    });
  }

  private totalActive(): number {
    return this.activeForeground + this.activeBackground;
  }

  private canAdmitForeground(): boolean {
    return this.totalActive() < this.options.maxConcurrent;
  }

  private canAdmitBackground(): boolean {
    const backgroundCapacity =
      this.options.maxConcurrent - this.options.reservedForeground;
    return (
      this.totalActive() < backgroundCapacity &&
      this.activeBackground < this.options.maxBackgroundConcurrent
    );
  }

  private admit(queued: QueuedAdmission): void {
    queued.signal?.removeEventListener("abort", queued.onAbort ?? (() => {}));
    if (queued.signal?.aborted) {
      queued.reject(abortError(queued.signal));
      return;
    }

    if (queued.priority === "foreground") this.activeForeground += 1;
    else this.activeBackground += 1;

    let released = false;
    queued.resolve({
      queueWaitMs: Date.now() - queued.enqueuedAt,
      release: () => {
        if (released) return;
        released = true;
        if (queued.priority === "foreground") this.activeForeground -= 1;
        else this.activeBackground -= 1;
        this.drain();
      },
    });
  }

  private drain(): void {
    while (this.foregroundQueue.length > 0 && this.canAdmitForeground()) {
      const queued = this.foregroundQueue.shift();
      if (queued) this.admit(queued);
    }
    while (
      this.foregroundQueue.length === 0 &&
      this.backgroundQueue.length > 0 &&
      this.canAdmitBackground()
    ) {
      const queued = this.backgroundQueue.shift();
      if (queued) this.admit(queued);
    }
  }
}

export const aiAdmissionController = new AiAdmissionController({
  maxConcurrent: 2,
  maxBackgroundConcurrent: 1,
  reservedForeground: 1,
});

export interface AiHarnessTelemetry {
  provider: string;
  callSite: string;
  operation:
    | "generate"
    | "stream"
    | "structured"
    | "tool_stream";
  priority: AiCallPriority;
  status: "completed" | "failed" | "cancelled";
  durationMs: number;
  queueWaitMs: number;
  ttftMs: number | null;
  retryCount: number;
  promptBudget: PromptBudgetTelemetry;
}

export interface AiHarnessContext {
  callSite: string;
  priority: AiCallPriority;
  promptBudget?: PromptBudgetTelemetry;
  telemetrySink?: (event: AiHarnessTelemetry) => void;
  admissionController?: AiAdmissionController;
}

function measuredPromptBudget(
  systemPrompt: string,
  messages: ChatMessage[],
): PromptBudgetTelemetry {
  const systemTokens = estimateTokens(systemPrompt.length);
  const totalMessageTokens = messageTokens(messages);
  const currentMessageTokens =
    messages.at(-1)?.role === "user"
      ? estimateTokens(messages.at(-1)?.content.length ?? 0)
      : 0;
  return {
    maxInputTokens: 0,
    estimatedInputTokens: systemTokens + totalMessageTokens,
    systemTokens,
    messageTokens: totalMessageTokens,
    currentMessageTokens,
    droppedMessages: 0,
    duplicateCurrentMessagesRemoved: 0,
    overBudget: false,
  };
}

function ensureNonEmpty(text: string, provider: string): string {
  if (text.trim().length === 0) {
    throw new Error(`${provider} returned an empty response.`);
  }
  return text;
}

function statusFor(error: unknown): "failed" | "cancelled" {
  return error instanceof Error && error.name === "AbortError"
    ? "cancelled"
    : "failed";
}

function reportTelemetry(
  event: AiHarnessTelemetry,
  sink?: (event: AiHarnessTelemetry) => void,
): void {
  sink?.(event);
  if (event.status === "completed") {
    logger.info("ai.harness.telemetry", { ...event });
  } else {
    logger.warn("ai.harness.telemetry", { ...event });
  }
}

/**
 * Provider-neutral runtime boundary for admission, cancellation, empty-reply
 * validation, and latency/retry/prompt-budget telemetry.
 */
export function withAiHarness(
  provider: AIProvider,
  context: AiHarnessContext,
): AIProvider {
  const admission = context.admissionController ?? aiAdmissionController;

  async function runText(
    operation: "generate" | "structured",
    systemPrompt: string,
    messages: ChatMessage[],
    onUsage: OnUsage | undefined,
    options: GenerationOptions | undefined,
    invoke: (options: GenerationOptions) => Promise<string>,
  ): Promise<string> {
    const startedAt = Date.now();
    let retryCount = 0;
    let queueWaitMs = 0;
    const promptBudget =
      context.promptBudget ?? measuredPromptBudget(systemPrompt, messages);
    let lease: AiAdmissionLease | null = null;
    try {
      lease = await admission.acquire(context.priority, options?.signal);
      queueWaitMs = lease.queueWaitMs;
      const result = ensureNonEmpty(
        await invoke({
          ...options,
          onEvent: (event) => {
            if (event.type === "retry") retryCount += 1;
            options?.onEvent?.(event);
          },
        }),
        provider.name,
      );
      reportTelemetry(
        {
          provider: provider.name,
          callSite: context.callSite,
          operation,
          priority: context.priority,
          status: "completed",
          durationMs: Date.now() - startedAt,
          queueWaitMs,
          ttftMs: Date.now() - startedAt,
          retryCount,
          promptBudget,
        },
        context.telemetrySink,
      );
      return result;
    } catch (error) {
      reportTelemetry(
        {
          provider: provider.name,
          callSite: context.callSite,
          operation,
          priority: context.priority,
          status: statusFor(error),
          durationMs: Date.now() - startedAt,
          queueWaitMs,
          ttftMs: null,
          retryCount,
          promptBudget,
        },
        context.telemetrySink,
      );
      throw error;
    } finally {
      lease?.release();
      void onUsage;
    }
  }

  const wrapped: AIProvider = {
    name: provider.name,

    generateResponse(
      systemPrompt,
      messages,
      onUsage,
      options,
    ) {
      return runText(
        "generate",
        systemPrompt,
        messages,
        onUsage,
        options,
        (forwarded) =>
          provider.generateResponse(
            systemPrompt,
            messages,
            onUsage,
            forwarded,
          ),
      );
    },

    async *streamResponse(
      systemPrompt,
      messages,
      onUsage,
      options,
    ) {
      const startedAt = Date.now();
      let retryCount = 0;
      let queueWaitMs = 0;
      let ttftMs: number | null = null;
      let yielded = false;
      const promptBudget =
        context.promptBudget ?? measuredPromptBudget(systemPrompt, messages);
      let lease: AiAdmissionLease | null = null;
      try {
        lease = await admission.acquire(context.priority, options?.signal);
        queueWaitMs = lease.queueWaitMs;
        const stream = provider.streamResponse(
          systemPrompt,
          messages,
          onUsage,
          {
            ...options,
            onEvent: (event) => {
              if (event.type === "retry") retryCount += 1;
              options?.onEvent?.(event);
            },
          },
        );
        for await (const chunk of stream) {
          if (chunk.length === 0) continue;
          if (ttftMs === null) ttftMs = Date.now() - startedAt;
          yielded = true;
          yield chunk;
        }
        if (!yielded) ensureNonEmpty("", provider.name);
        reportTelemetry(
          {
            provider: provider.name,
            callSite: context.callSite,
            operation: "stream",
            priority: context.priority,
            status: "completed",
            durationMs: Date.now() - startedAt,
            queueWaitMs,
            ttftMs,
            retryCount,
            promptBudget,
          },
          context.telemetrySink,
        );
      } catch (error) {
        reportTelemetry(
          {
            provider: provider.name,
            callSite: context.callSite,
            operation: "stream",
            priority: context.priority,
            status: statusFor(error),
            durationMs: Date.now() - startedAt,
            queueWaitMs,
            ttftMs,
            retryCount,
            promptBudget,
          },
          context.telemetrySink,
        );
        throw error;
      } finally {
        lease?.release();
      }
    },

    generateStructuredResponse(
      systemPrompt,
      messages,
      onUsage,
      options,
    ) {
      return runText(
        "structured",
        systemPrompt,
        messages,
        onUsage,
        options,
        (forwarded) =>
          provider.generateStructuredResponse(
            systemPrompt,
            messages,
            onUsage,
            forwarded,
          ),
      );
    },
  };

  if (provider.streamWithTools) {
    const inner = provider.streamWithTools.bind(provider);
    wrapped.streamWithTools = async function* (
      systemPrompt: string,
      messages: ChatMessage[],
      tools: ToolDeclaration[],
      onToolCall: ToolCallHandler,
      options?: ToolStreamOptions,
    ): AsyncGenerator<ToolStreamEvent> {
      const startedAt = Date.now();
      let retryCount = 0;
      let queueWaitMs = 0;
      let ttftMs: number | null = null;
      let meaningfulEvent = false;
      const promptBudget =
        context.promptBudget ?? measuredPromptBudget(systemPrompt, messages);
      let lease: AiAdmissionLease | null = null;
      try {
        lease = await admission.acquire(context.priority, options?.signal);
        queueWaitMs = lease.queueWaitMs;
        const stream = inner(systemPrompt, messages, tools, onToolCall, {
          ...options,
          onEvent: (event) => {
            if (event.type === "retry") retryCount += 1;
            options?.onEvent?.(event);
          },
        });
        for await (const event of stream) {
          if (event.kind !== "done") {
            meaningfulEvent = true;
            if (ttftMs === null) ttftMs = Date.now() - startedAt;
          }
          yield event;
        }
        if (!meaningfulEvent) ensureNonEmpty("", provider.name);
        reportTelemetry(
          {
            provider: provider.name,
            callSite: context.callSite,
            operation: "tool_stream",
            priority: context.priority,
            status: "completed",
            durationMs: Date.now() - startedAt,
            queueWaitMs,
            ttftMs,
            retryCount,
            promptBudget,
          },
          context.telemetrySink,
        );
      } catch (error) {
        reportTelemetry(
          {
            provider: provider.name,
            callSite: context.callSite,
            operation: "tool_stream",
            priority: context.priority,
            status: statusFor(error),
            durationMs: Date.now() - startedAt,
            queueWaitMs,
            ttftMs,
            retryCount,
            promptBudget,
          },
          context.telemetrySink,
        );
        throw error;
      } finally {
        lease?.release();
      }
    };
  }

  return wrapped;
}
