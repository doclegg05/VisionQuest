import { prisma } from "@/lib/db";
import { resolveAiProvider } from "@/lib/ai";
import { getProviderClass, logAiAuditEvent, policyDecisionForProvider } from "@/lib/ai/audit";
import { determineStage } from "@/lib/sage/system-prompts";
import { notFound } from "@/lib/api-error";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import { logger } from "@/lib/logger";
import { estimateTokens } from "@/lib/llm-usage-estimate";

/**
 * Load an existing conversation or create a new one.
 * For new conversations: fetches goals, determines stage, deactivates old goal convos.
 */
const ALLOWED_REQUESTED_STAGES = new Set([
  "discovery",
  "career_profile_review",
]);

export async function getOrCreateConversation(
  studentId: string,
  conversationId: string | null,
  requestedStage?: string,
) {
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, studentId },
      include: { messages: { orderBy: { createdAt: "desc" as const }, take: 50 } },
    });
    if (!conversation) throw notFound("Conversation not found.");
    if (conversation.messages) {
      conversation.messages.reverse();
    }
    return conversation;
  }

  // If a specific stage is requested (e.g. from ?stage=career_profile_review), use it
  // but only for known allowed stages to prevent injection.
  const explicitStage =
    requestedStage && ALLOWED_REQUESTED_STAGES.has(requestedStage)
      ? requestedStage
      : null;

  let stage: string;

  if (explicitStage) {
    stage = explicitStage;
  } else {
    // New conversation — determine stage from existing goals + discovery status
    const [goals, discovery, careerPlan] = await Promise.all([
      prisma.goal.findMany({
        where: { studentId, status: { in: [...GOAL_PLANNING_STATUSES] } },
        select: { level: true },
      }),
      prisma.careerDiscovery.findUnique({
        where: { studentId },
        select: { status: true },
      }),
      prisma.careerEducationPlan.findUnique({
        where: { studentId },
        select: { status: true },
      }),
    ]);
    stage = determineStage(
      goals,
      discovery?.status === "complete",
      careerPlan?.status === "confirmed",
    );
  }

  // Deactivate previous goal conversations
  await prisma.conversation.updateMany({
    where: { studentId, module: "goal", active: true },
    data: { active: false },
  });

  return prisma.conversation.create({
    data: { studentId, module: "goal", stage, active: true },
    include: { messages: true },
  });
}

/**
 * Load or create a teacher assistant conversation.
 * Teacher conversations use a fixed "teacher_assistant" stage and module.
 */
export async function getOrCreateTeacherConversation(
  teacherId: string,
  conversationId: string | null,
) {
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, studentId: teacherId },
      include: { messages: { orderBy: { createdAt: "desc" as const }, take: 50 } },
    });
    if (!conversation) throw notFound("Conversation not found.");
    if (conversation.messages) {
      conversation.messages.reverse();
    }
    return conversation;
  }

  // Deactivate previous teacher assistant conversations
  await prisma.conversation.updateMany({
    where: { studentId: teacherId, module: "teacher_assistant", active: true },
    data: { active: false },
  });

  return prisma.conversation.create({
    data: { studentId: teacherId, module: "teacher_assistant", stage: "teacher_assistant", active: true },
    include: { messages: true },
  });
}

/**
 * Save a message (user or assistant) to a conversation.
 */
export async function saveMessage(
  conversationId: string,
  studentId: string,
  role: "user" | "assistant",
  content: string,
) {
  return prisma.message.create({
    data: { conversationId, studentId, role, content },
  });
}

/**
 * Generate a short title from the first assistant response.
 * Only sets title if conversation has <= 4 messages and no existing title.
 */
export async function generateConversationTitle(
  conversationId: string,
  assistantResponse: string,
  existingTitle: string | null,
) {
  const msgCount = await prisma.message.count({ where: { conversationId } });
  if (msgCount > 4 || existingTitle) return;

  const titleSummary = assistantResponse.slice(0, 60).replace(/\n/g, " ").trim();
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { title: titleSummary + (titleSummary.length >= 60 ? "..." : "") },
  });
}

// ─── Session Summary Compaction ─────────────────────────────────────────────

/**
 * Estimated-token budgets for the conversation HISTORY passed to the model
 * (recent messages + injected rolling summary). They do NOT cover the system
 * prompt, which is budgeted separately in the chat route.
 *
 * Scaled to match the existing per-tier message caps (compact: 6/12 recent
 * messages, full: 20): with the char/4 estimator, 3000 tokens ≈ 12k chars of
 * history for small local models, 12000 tokens ≈ 48k chars for cloud models.
 */
export const COMPACT_HISTORY_TOKEN_BUDGET = 3000;
export const FULL_HISTORY_TOKEN_BUDGET = 12000;

/**
 * Budget trimming never drops the current exchange: the most recent
 * user/assistant pair always survives, even if it alone exceeds the budget
 * (flagged via `overBudget` on the returned context).
 */
export const MIN_RETAINED_MESSAGES = 2;

export interface ConversationContext {
  messages: { role: "user" | "model"; content: string }[];
  summaryInjected: boolean;
  /** Messages dropped (oldest first) to fit the history token budget. */
  droppedForBudget: number;
  /** True when even the minimum retained history still exceeds the budget. */
  overBudget: boolean;
}

/**
 * Returns an optimized message history for a Gemini call.
 * If the conversation has a rolling summary and more messages than
 * `maxRecentMessages`, the summary is prepended as a synthetic model
 * message and only the most recent messages are returned.
 *
 * On top of the message-count cap, the history is trimmed oldest-first until
 * its estimated token total (summary included) fits `historyTokenBudget`.
 * The rolling summary always survives trimming — it is the compressed past.
 */
export async function getConversationContext(
  conversationId: string,
  maxRecentMessages: number = 20,
  historyTokenBudget: number = FULL_HISTORY_TOKEN_BUDGET,
): Promise<ConversationContext> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { summary: true, summaryUpToMessageId: true },
  });

  // Load recent messages (descending, then reverse for chronological order)
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: maxRecentMessages,
    select: { id: true, role: true, content: true, createdAt: true },
  });
  messages.reverse();

  // Summary injection rule is unchanged: only when the conversation holds
  // more messages than the loaded window.
  let summaryMessage: { role: "model"; content: string } | null = null;
  if (conversation?.summary) {
    const totalCount = await prisma.message.count({ where: { conversationId } });
    if (totalCount > maxRecentMessages) {
      summaryMessage = {
        role: "model",
        content: `[Previous conversation summary: ${conversation.summary}]`,
      };
    }
  }

  // Budget-aware trim: drop oldest messages until the estimated history total
  // (summary always included and never trimmed) fits the budget, but never
  // trim below the MIN_RETAINED_MESSAGES most recent messages.
  const summaryTokens = summaryMessage
    ? estimateTokens(summaryMessage.content.length)
    : 0;
  const perMessageTokens = messages.map((m) => estimateTokens(m.content.length));
  let estimatedTokens =
    summaryTokens + perMessageTokens.reduce((sum, tokens) => sum + tokens, 0);

  let droppedForBudget = 0;
  while (
    estimatedTokens > historyTokenBudget &&
    messages.length - droppedForBudget > MIN_RETAINED_MESSAGES
  ) {
    estimatedTokens -= perMessageTokens[droppedForBudget];
    droppedForBudget += 1;
  }
  const overBudget = estimatedTokens > historyTokenBudget;
  const kept = droppedForBudget > 0 ? messages.slice(droppedForBudget) : messages;

  if (droppedForBudget > 0) {
    // Dropped messages newer than summaryUpToMessageId are not represented in
    // the rolling summary — acceptable loss for this turn, but worth counting.
    const summaryUpToIndex = conversation?.summaryUpToMessageId
      ? messages.findIndex((m) => m.id === conversation.summaryUpToMessageId)
      : -1;
    const droppedUncoveredBySummary = summaryMessage
      ? messages
          .slice(0, droppedForBudget)
          .filter((_, index) => summaryUpToIndex < 0 || index > summaryUpToIndex)
          .length
      : droppedForBudget;
    logger.info("sage.history.trim", {
      conversationId,
      budgetTokens: historyTokenBudget,
      estTokens: estimatedTokens,
      droppedForBudget,
      droppedUncoveredBySummary,
      keptMessages: kept.length,
      summaryInjected: Boolean(summaryMessage),
      overBudget,
    });
  }
  if (overBudget) {
    logger.warn("sage.history.over_budget", {
      conversationId,
      budgetTokens: historyTokenBudget,
      estTokens: estimatedTokens,
      keptMessages: kept.length,
    });
  }

  const formatted = kept.map((m) => ({
    role: (m.role === "user" ? "user" : "model") as "user" | "model",
    content: m.content,
  }));

  return {
    messages: summaryMessage ? [summaryMessage, ...formatted] : formatted,
    summaryInjected: Boolean(summaryMessage),
    droppedForBudget,
    overBudget,
  };
}

const COMPACTION_SYSTEM_PROMPT =
  "You are a conversation summarizer for an AI coaching platform called VisionQuest. " +
  "Produce clear, factual summaries in third person, past tense. " +
  "Focus on: goals discussed, decisions made, progress reported, emotional state, " +
  "and any important personal context. Keep summaries concise (2-3 paragraphs max).";

/**
 * Checks whether the rolling conversation summary needs updating and, if so,
 * summarizes new messages and appends them to the existing summary.
 *
 * Called fire-and-forget after the AI response is saved.
 */
export async function maybeUpdateSummary(
  conversationId: string,
  studentId: string,
  updateInterval: number = 10,
): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { summary: true, summaryUpToMessageId: true },
  });

  // Build a where clause for messages since the last summary point
  const whereClause: {
    conversationId: string;
    createdAt?: { gt: Date };
  } = { conversationId };

  if (conversation?.summaryUpToMessageId) {
    const lastSummarizedMsg = await prisma.message.findUnique({
      where: { id: conversation.summaryUpToMessageId },
      select: { createdAt: true },
    });
    if (lastSummarizedMsg) {
      whereClause.createdAt = { gt: lastSummarizedMsg.createdAt };
    }
  }

  const newMessageCount = await prisma.message.count({ where: whereClause });
  if (newMessageCount < updateInterval) return;

  // Get messages to summarize
  const messagesToSummarize = await prisma.message.findMany({
    where: whereClause,
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, content: true },
  });

  if (messagesToSummarize.length === 0) return;

  // Build text to summarize
  const existingSummary = conversation?.summary || "";
  const newText = messagesToSummarize
    .map((m) => `${m.role === "user" ? "Student" : "Sage"}: ${m.content}`)
    .join("\n\n");

  const summaryPrompt = existingSummary
    ? `Here is the existing conversation summary:\n${existingSummary}\n\nHere are the new messages to incorporate:\n${newText}\n\nUpdate the summary to include the key points from the new messages. Keep it concise (2-3 paragraphs max). Focus on: goals discussed, decisions made, progress reported, and emotional state.`
    : `Summarize this coaching conversation. Focus on: goals discussed, decisions made, progress reported, and emotional state. Keep it concise (2-3 paragraphs max).\n\n${newText}`;

  const provider = await resolveAiProvider({
    studentId,
    task: "conversation_summary",
    sensitivity: "student_record",
  });
  const providerClass = getProviderClass(provider.name);
  const summaryPolicyDecision = policyDecisionForProvider(provider.name);
  const summaryAllowCloud = providerClass === "cloud";
  await logAiAuditEvent({
    actorId: studentId,
    actorRole: "student",
    route: "background:chat/summary",
    task: "conversation_summary",
    sensitivity: "student_record",
    policyDecision: summaryPolicyDecision,
    status: "routed",
    targetId: conversationId,
    providerName: provider.name,
    providerClass,
    allowCloud: summaryAllowCloud,
    inputChars: summaryPrompt.length,
    reason:
      summaryPolicyDecision === "local_only"
        ? "Conversation summaries use student conversation content and are local-only by policy."
        : "Operator configured cloud AI; conversation summary routed to the configured provider.",
  });
  const updatedSummary = await provider.generateResponse(
    COMPACTION_SYSTEM_PROMPT,
    [{ role: "user", content: summaryPrompt }],
  );
  await logAiAuditEvent({
    actorId: studentId,
    actorRole: "student",
    route: "background:chat/summary",
    task: "conversation_summary",
    sensitivity: "student_record",
    policyDecision: summaryPolicyDecision,
    status: "completed",
    targetId: conversationId,
    providerName: provider.name,
    providerClass,
    allowCloud: summaryAllowCloud,
    inputChars: summaryPrompt.length,
    outputChars: updatedSummary.length,
  });

  const lastMessageId =
    messagesToSummarize[messagesToSummarize.length - 1].id;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      summary: updatedSummary,
      summaryUpToMessageId: lastMessageId,
    },
  });

  logger.info("Rolling conversation summary updated", {
    conversationId,
    studentId,
    messagesCompacted: messagesToSummarize.length,
    summaryLength: updatedSummary.length,
  });
}
