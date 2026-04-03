import { prisma } from "@/lib/db";
import { generateResponse } from "@/lib/gemini";
import { determineStage } from "@/lib/sage/system-prompts";
import { notFound } from "@/lib/api-error";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import { logger } from "@/lib/logger";

/**
 * Load an existing conversation or create a new one.
 * For new conversations: fetches goals, determines stage, deactivates old goal convos.
 */
const ALLOWED_REQUESTED_STAGES = new Set([
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
    const [goals, discovery] = await Promise.all([
      prisma.goal.findMany({
        where: { studentId, status: { in: [...GOAL_PLANNING_STATUSES] } },
        select: { level: true },
      }),
      prisma.careerDiscovery.findUnique({
        where: { studentId },
        select: { status: true },
      }),
    ]);
    stage = determineStage(goals, discovery?.status === "complete");
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
  role: "user" | "assistant",
  content: string,
  studentId: string,
) {
  return prisma.message.create({
    data: { conversationId, role, content, studentId },
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

export interface ConversationContext {
  messages: { role: "user" | "model"; content: string }[];
  summaryInjected: boolean;
}

/**
 * Returns an optimized message history for a Gemini call.
 * If the conversation has a rolling summary and more messages than
 * `maxRecentMessages`, the summary is prepended as a synthetic model
 * message and only the most recent messages are returned.
 */
export async function getConversationContext(
  conversationId: string,
  maxRecentMessages: number = 20,
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

  const formatted = messages.map((m) => ({
    role: (m.role === "user" ? "user" : "model") as "user" | "model",
    content: m.content,
  }));

  // If we have a summary and there are more messages than we loaded, prepend it
  if (conversation?.summary) {
    const totalCount = await prisma.message.count({ where: { conversationId } });
    if (totalCount > maxRecentMessages) {
      return {
        messages: [
          {
            role: "model" as const,
            content: `[Previous conversation summary: ${conversation.summary}]`,
          },
          ...formatted,
        ],
        summaryInjected: true,
      };
    }
  }

  return { messages: formatted, summaryInjected: false };
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
  apiKey: string,
  studentId?: string,
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

  const updatedSummary = await generateResponse(
    apiKey,
    COMPACTION_SYSTEM_PROMPT,
    [{ role: "user", content: summaryPrompt }],
  );

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
