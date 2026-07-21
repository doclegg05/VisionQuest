import { prisma } from "./db";
import { logger } from "./logger";
import { estimateTokens } from "./llm-usage-estimate";
import { SAGE_PROMPT_REVISION } from "./sage/prompt-revision";
import type {
  AIProvider,
  ChatMessage,
  OnUsage,
  ToolCallHandler,
  ToolDeclaration,
  ToolStreamEvent,
  ToolStreamOptions,
  TokenUsage,
} from "./ai/types";

// ─── Token Logging ──────────────────────────────────────────────────────────

interface LogLlmCallParams {
  /** Null for system calls (embedding ingest/backfill) with no student. */
  studentId: string | null;
  callSite: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs?: number;
  /**
   * Prompt-revision attribution tag. Defaults to the live
   * SAGE_PROMPT_REVISION so every call is stamped automatically; pass an
   * explicit value only when logging on behalf of a different prompt stack.
   */
  promptRevision?: string | null;
}

export async function logLlmCall(params: LogLlmCallParams): Promise<void> {
  try {
    await prisma.llmCallLog.create({
      data: {
        studentId: params.studentId,
        callSite: params.callSite,
        model: params.model,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        totalTokens: params.totalTokens,
        durationMs: params.durationMs ?? null,
        promptRevision: params.promptRevision ?? SAGE_PROMPT_REVISION,
      },
    });
  } catch (error) {
    // Token logging is non-critical; log and continue
    logger.error("Failed to log LLM call", { error: String(error) });
  }
}

// ─── Token Quota Enforcement ────────────────────────────────────────────────

export interface QuotaStatus {
  allowed: boolean;
  tokensUsedToday: number;
  softCap: number;
  hardCap: number;
  warning?: string;
}

// Default quotas -- can be overridden per-student later
const DEFAULT_STUDENT_SOFT_CAP = 40_000; // tokens/day -- triggers warning
const DEFAULT_STUDENT_HARD_CAP = 50_000; // tokens/day -- blocks further AI calls
const DEFAULT_TEACHER_SOFT_CAP = 150_000;
const DEFAULT_TEACHER_HARD_CAP = 200_000;

export async function checkTokenQuota(
  studentId: string,
  role: string = "student",
): Promise<QuotaStatus> {
  const isStaff = role === "teacher" || role === "admin";
  const softCap = isStaff ? DEFAULT_TEACHER_SOFT_CAP : DEFAULT_STUDENT_SOFT_CAP;
  const hardCap = isStaff ? DEFAULT_TEACHER_HARD_CAP : DEFAULT_STUDENT_HARD_CAP;

  // Sum tokens used today (midnight boundary)
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const result = await prisma.llmCallLog.aggregate({
    where: {
      studentId,
      createdAt: { gte: startOfDay },
    },
    _sum: { totalTokens: true },
  });

  const tokensUsedToday = result._sum.totalTokens ?? 0;

  if (tokensUsedToday >= hardCap) {
    return {
      allowed: false,
      tokensUsedToday,
      softCap,
      hardCap,
      warning:
        "You've reached your daily AI usage limit. Your limit resets at midnight — try again tomorrow, or speak with your instructor.",
    };
  }

  if (tokensUsedToday >= softCap) {
    return {
      allowed: true,
      tokensUsedToday,
      softCap,
      hardCap,
      warning:
        "You're approaching your daily AI usage limit. Consider saving complex questions for tomorrow.",
    };
  }

  return { allowed: true, tokensUsedToday, softCap, hardCap };
}

// ─── Usage-Logging Provider Proxy ───────────────────────────────────────────

export interface WithUsageLoggingContext {
  /** Null for system calls (embedding ingest/backfill) with no student. */
  studentId: string | null;
  callSite: string;
  /** Overrides provider.name in the logged row when set. */
  model?: string;
  /** Overrides the default SAGE_PROMPT_REVISION stamp in the logged row when set. */
  promptRevision?: string;
}

function fallbackUsage(inputChars: number, outputChars: number): TokenUsage {
  const inputTokens = estimateTokens(inputChars);
  const outputTokens = estimateTokens(outputChars);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: "estimated",
  };
}

function totalMessageChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}

/**
 * Wraps an AIProvider so every underlying model call writes one
 * `logLlmCall` row with real provider-reported usage when the provider
 * supplies it via `onUsage`, falling back to the shared char/4 estimator
 * otherwise. Non-invasive: callers use the returned provider exactly like
 * the original.
 *
 * `streamWithTools` passthrough is capability-detected — if the wrapped
 * provider doesn't implement it, the proxy does not synthesize one, so
 * `Boolean(provider.streamWithTools)` checks elsewhere (e.g. the agent
 * loop's fallback-to-plain-stream logic) keep working correctly.
 */
export function withUsageLogging(
  provider: AIProvider,
  ctx: WithUsageLoggingContext,
): AIProvider {
  const model = ctx.model ?? provider.name;

  const record = (usage: TokenUsage, durationMs: number): void => {
    void logLlmCall({
      studentId: ctx.studentId,
      callSite: ctx.callSite,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      durationMs,
      promptRevision: ctx.promptRevision,
    });
  };

  const wrapped: AIProvider = {
    name: provider.name,

    async generateResponse(
      systemPrompt: string,
      messages: ChatMessage[],
      onUsage?: OnUsage,
    ): Promise<string> {
      const startedAt = Date.now();
      let captured: TokenUsage | null = null;
      const result = await provider.generateResponse(systemPrompt, messages, (usage) => {
        captured = usage;
        onUsage?.(usage);
      });
      const usage =
        captured ?? fallbackUsage(systemPrompt.length + totalMessageChars(messages), result.length);
      record(usage, Date.now() - startedAt);
      return result;
    },

    async *streamResponse(
      systemPrompt: string,
      messages: ChatMessage[],
      onUsage?: OnUsage,
    ): AsyncGenerator<string> {
      const startedAt = Date.now();
      let captured: TokenUsage | null = null;
      let outputChars = 0;
      for await (const chunk of provider.streamResponse(systemPrompt, messages, (usage) => {
        captured = usage;
        onUsage?.(usage);
      })) {
        outputChars += chunk.length;
        yield chunk;
      }
      const usage =
        captured ?? fallbackUsage(systemPrompt.length + totalMessageChars(messages), outputChars);
      record(usage, Date.now() - startedAt);
    },

    async generateStructuredResponse(
      systemPrompt: string,
      messages: ChatMessage[],
      onUsage?: OnUsage,
    ): Promise<string> {
      const startedAt = Date.now();
      let captured: TokenUsage | null = null;
      const result = await provider.generateStructuredResponse(systemPrompt, messages, (usage) => {
        captured = usage;
        onUsage?.(usage);
      });
      const usage =
        captured ?? fallbackUsage(systemPrompt.length + totalMessageChars(messages), result.length);
      record(usage, Date.now() - startedAt);
      return result;
    },
  };

  if (provider.streamWithTools) {
    const innerStreamWithTools = provider.streamWithTools.bind(provider);
    wrapped.streamWithTools = async function* (
      systemPrompt: string,
      messages: ChatMessage[],
      tools: ToolDeclaration[],
      onToolCall: ToolCallHandler,
      options?: ToolStreamOptions,
    ): AsyncGenerator<ToolStreamEvent> {
      const startedAt = Date.now();
      let captured: TokenUsage | null = null;
      let outputChars = 0;
      const stream = innerStreamWithTools(systemPrompt, messages, tools, onToolCall, {
        ...options,
        onUsage: (usage) => {
          captured = usage;
          options?.onUsage?.(usage);
        },
      });
      for await (const event of stream) {
        if (event.kind === "text") outputChars += event.text.length;
        yield event;
      }
      const usage =
        captured ?? fallbackUsage(systemPrompt.length + totalMessageChars(messages), outputChars);
      record(usage, Date.now() - startedAt);
    };
  }

  return wrapped;
}
