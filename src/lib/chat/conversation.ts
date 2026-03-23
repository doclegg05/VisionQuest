import { prisma } from "@/lib/db";
import { determineStage } from "@/lib/sage/system-prompts";
import { notFound } from "@/lib/api-error";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";

/**
 * Load an existing conversation or create a new one.
 * For new conversations: fetches goals, determines stage, deactivates old goal convos.
 */
export async function getOrCreateConversation(
  studentId: string,
  conversationId: string | null,
) {
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, studentId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) throw notFound("Conversation not found.");
    return conversation;
  }

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
  const stage = determineStage(goals, discovery?.status === "complete");

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
