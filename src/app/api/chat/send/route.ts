import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { streamResponse } from "@/lib/gemini";
import { rateLimit } from "@/lib/rate-limit";
import { buildSystemPrompt, ConversationStage } from "@/lib/sage/system-prompts";
import { recordChatSession } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/api-error";
import { parseBody, chatSendSchema } from "@/lib/schemas";
import { resolveApiKey } from "@/lib/chat/api-key";
import { getOrCreateConversation, saveMessage } from "@/lib/chat/conversation";
import { handlePostResponse } from "@/lib/chat/post-response";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import { buildStudentStatusSignals, buildStudentStatusSummary } from "@/lib/student-status";
import { formatClustersForPrompt } from "@/lib/spokes/career-clusters";

// ─── Route handler ──────────────────────────────────────────────────────────

export const POST = withAuth(async (session, req: NextRequest) => {
  const body = await parseBody(req, chatSendSchema);
  const userMessage = body.message.trim();
  const conversationId = body.conversationId || null;

  // Rate limit
  const rl = await rateLimit(`chat:${session.id}`, 60, 60 * 60 * 1000);
  if (!rl.success) {
    return new Response(JSON.stringify({ error: "Too many messages. Please wait before sending more." }), { status: 429 });
  }

  // Resolve API key
  const apiKey = await resolveApiKey(session.id);

  // Get or create conversation
  const conversation = await getOrCreateConversation(session.id, conversationId);

  // Save user message
  await saveMessage(conversation.id, "user", userMessage);

  // Build system prompt context
  const [goals, orientationItems, formSubmissions, orientationProgress, careerDiscovery] = await Promise.all([
    prisma.goal.findMany({
      where: { studentId: session.id, status: { in: [...GOAL_PLANNING_STATUSES] } },
    }),
    prisma.orientationItem.findMany({
      select: {
        id: true,
        label: true,
        required: true,
      },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.formSubmission.findMany({
      where: { studentId: session.id },
      select: {
        formId: true,
        status: true,
        updatedAt: true,
        reviewedAt: true,
        notes: true,
      },
    }),
    prisma.orientationProgress.findMany({
      where: { studentId: session.id },
      select: {
        itemId: true,
        completed: true,
        completedAt: true,
      },
    }),
    prisma.careerDiscovery.findUnique({
      where: { studentId: session.id },
      select: { status: true, sageSummary: true, topClusters: true },
    }),
  ]);
  const goalsByLevel: Record<string, string> = {};
  for (const g of goals) goalsByLevel[g.level] = g.content;
  const studentStatusSummary = buildStudentStatusSummary(
    buildStudentStatusSignals({
      formSubmissions,
      orientationItems,
      orientationProgress,
    }),
    { includePositiveSummary: conversation.stage === "orientation" || conversation.stage === "onboarding" },
  );

  // Build discovery context for the prompt
  const isDiscoveryStage = conversation.stage === "discovery";
  const discoverySummary = careerDiscovery?.sageSummary && careerDiscovery.topClusters.length > 0
    ? `${careerDiscovery.sageSummary} (Top pathways: ${careerDiscovery.topClusters.join(", ")})`
    : undefined;

  const systemPrompt = buildSystemPrompt(conversation.stage as ConversationStage, {
    studentName: session.displayName,
    bhag: goalsByLevel["bhag"],
    monthly: goalsByLevel["monthly"],
    weekly: goalsByLevel["weekly"],
    daily: goalsByLevel["daily"],
    goals_summary: goals.length > 0
      ? goals.map((g) => `- ${g.level.toUpperCase()}: ${g.content}`).join("\n")
      : "No planning goals set yet.",
    student_status_summary: studentStatusSummary || undefined,
    userMessage,
    career_clusters: isDiscoveryStage ? formatClustersForPrompt() : undefined,
    discovery_summary: discoverySummary,
  });

  // Format message history for Gemini
  const allMessages = [
    ...conversation.messages.map((m) => ({
      role: (m.role === "user" ? "user" : "model") as "user" | "model",
      content: m.content,
    })),
    { role: "user" as const, content: userMessage },
  ];

  // Stream response via SSE
  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ conversationId: conversation.id })}\n\n`));

        for await (const chunk of streamResponse(apiKey, systemPrompt, allMessages)) {
          fullResponse += chunk;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
        }

        // Save assistant message
        await saveMessage(conversation.id, "assistant", fullResponse);

        // Award chat session XP (synchronous — happens before stream closes)
        await awardEvent({
          studentId: session.id,
          eventType: "chat_session",
          sourceType: "conversation",
          sourceId: conversation.id,
          xp: 10,
          mutate: (state) => recordChatSession(state),
        });

        // Fire-and-forget: goal extraction, XP awards, stage updates, title generation
        handlePostResponse({
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          conversationStage: conversation.stage,
          fullResponse,
          studentId: session.id,
          apiKey,
          allMessages,
        }).catch((err) => logger.error("Post-response error", { error: String(err) }));

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, conversationId: conversation.id })}\n\n`));
        controller.close();
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error("Stream error", { error: String(error) });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `Failed to generate response: ${errMsg}` })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
