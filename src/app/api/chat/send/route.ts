import { prisma } from "@/lib/db";
import { streamResponse } from "@/lib/gemini";
import { rateLimit } from "@/lib/rate-limit";
import { buildSystemPrompt, ConversationStage } from "@/lib/sage/system-prompts";
import { getDocumentContext } from "@/lib/sage/knowledge-base";
import { recordChatSession } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { logger } from "@/lib/logger";
import { isStaffRole } from "@/lib/api-error";
import { withRegistry } from "@/lib/registry/middleware";
import { parseBody, chatSendSchema } from "@/lib/schemas";
import { resolveApiKey } from "@/lib/chat/api-key";
import { getOrCreateConversation, getOrCreateTeacherConversation, saveMessage, getConversationContext, maybeUpdateSummary } from "@/lib/chat/conversation";
import { handlePostResponse } from "@/lib/chat/post-response";
import { getStudentPromptContext } from "@/lib/chat/context";
import { formatClustersForPrompt } from "@/lib/spokes/career-clusters";
import { checkTokenQuota } from "@/lib/llm-usage";

// ─── Route handler ──────────────────────────────────────────────────────────

export const POST = withRegistry("sage.chat", async (session, req, ctx, tool) => {
  const body = await parseBody(req, chatSendSchema);
  const userMessage = body.message.trim();
  const conversationId = body.conversationId || null;
  const requestedStage = body.requestedStage;
  const isTeacher = isStaffRole(session.role);

  // Rate limit
  const rl = await rateLimit(`chat:${session.id}`, 60, 60 * 60 * 1000);
  if (!rl.success) {
    return new Response(JSON.stringify({ error: "Too many messages. Please wait before sending more." }), { status: 429 });
  }

  // Check token quota before making AI call
  const quota = await checkTokenQuota(session.id, session.role);
  if (!quota.allowed) {
    return new Response(
      JSON.stringify({ error: quota.warning }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  // Resolve API key
  const apiKey = await resolveApiKey(session.id);

  // Get or create conversation (teacher vs student path)
  const conversation = isTeacher
    ? await getOrCreateTeacherConversation(session.id, conversationId)
    : await getOrCreateConversation(session.id, conversationId, requestedStage);

  // Save user message
  await saveMessage(conversation.id, "user", userMessage, conversation.studentId);

  // Build system prompt — teacher gets a streamlined path
  let systemPrompt: string;

  if (isTeacher) {
    systemPrompt = buildSystemPrompt("teacher_assistant", {
      studentName: session.displayName,
      userMessage,
    });
  } else {
    const promptContext = await getStudentPromptContext(
      session.id,
      conversation.id,
      conversation.stage as ConversationStage,
    );

    systemPrompt =
      promptContext.priorConversationContext +
      buildSystemPrompt(conversation.stage as ConversationStage, {
        studentName: session.displayName,
        bhag: promptContext.goalsByLevel["bhag"],
        monthly: promptContext.goalsByLevel["monthly"],
        weekly: promptContext.goalsByLevel["weekly"],
        daily: promptContext.goalsByLevel["daily"],
        goals_summary: promptContext.goalsSummary,
        student_status_summary: promptContext.studentStatusSummary,
        userMessage,
        career_clusters:
          conversation.stage === "discovery"
            ? formatClustersForPrompt()
            : undefined,
        discovery_summary: promptContext.discoverySummary,
        career_profile_context: promptContext.careerProfileContext,
        skillGapContext: promptContext.skillGapContext,
        pathwayContext: promptContext.pathwayContext,
        coachingArcContext: promptContext.coachingArcContext,
      });
  }

  // Inject document-based context from ProgramDocument (RAG layer)
  const documentContext = await getDocumentContext(userMessage);
  if (documentContext) {
    systemPrompt += documentContext;
  }

  // Format message history for Gemini, using compacted context when available
  const conversationContext = await getConversationContext(conversation.id);
  const allMessages = [
    ...conversationContext.messages,
    { role: "user" as const, content: userMessage },
  ];

  // Stream response via SSE
  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ conversationId: conversation.id })}\n\n`));

        // Send soft-cap warning as an SSE event before the AI response
        if (quota.warning) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ quotaWarning: quota.warning })}\n\n`));
        }

        for await (const chunk of streamResponse(apiKey, systemPrompt, allMessages)) {
          fullResponse += chunk;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
        }

        // Save assistant message
        await saveMessage(conversation.id, "assistant", fullResponse, conversation.studentId);

        // Rolling summary compaction (fire-and-forget, both teacher and student)
        void maybeUpdateSummary(conversation.id, apiKey, session.id).catch((err) =>
          logger.error("Summary compaction failed", { conversationId: conversation.id, error: String(err) }),
        );

        // Student-only post-processing: XP, goal extraction, stage updates
        if (!isTeacher) {
          try {
            await awardEvent({
              studentId: session.id,
              eventType: "chat_session",
              sourceType: "conversation",
              sourceId: conversation.id,
              xp: 10,
              mutate: (state) => recordChatSession(state),
            });
          } catch (err) {
            logger.error("Failed to award chat XP", { error: String(err) });
          }

          handlePostResponse({
            conversationId: conversation.id,
            conversationTitle: conversation.title,
            conversationStage: conversation.stage,
            fullResponse,
            studentId: session.id,
            apiKey,
            allMessages,
          }).catch((err) => logger.error("Post-response error", { error: String(err) }));
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, conversationId: conversation.id })}\n\n`));
        controller.close();
      } catch (error) {
        logger.error("Stream error", { error: error instanceof Error ? error.message : String(error) });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Something went wrong generating a response. Please try again." })}\n\n`));
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
