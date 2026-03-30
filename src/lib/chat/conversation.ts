import { prisma } from "@/lib/db";
import { determineStage } from "@/lib/sage/system-prompts";
import { notFound } from "@/lib/api-error";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";

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
) {
  return prisma.message.create({
    data: { conversationId, role, content },
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
