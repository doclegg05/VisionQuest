import { prisma } from "./db";
import { logger } from "./logger";

// ─── Token Logging ──────────────────────────────────────────────────────────

interface LogLlmCallParams {
  studentId: string;
  callSite: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs?: number;
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
