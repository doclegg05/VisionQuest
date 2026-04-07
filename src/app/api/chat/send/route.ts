import { prisma } from "@/lib/db";
import { getProvider } from "@/lib/ai";
import { rateLimit, rateLimitDaily } from "@/lib/rate-limit";
import { buildSystemPrompt, ConversationStage } from "@/lib/sage/system-prompts";
import { getDocumentContext } from "@/lib/sage/knowledge-base";
import { recordChatSession } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { logger } from "@/lib/logger";
import { isStaffRole } from "@/lib/api-error";
import { withRegistry } from "@/lib/registry/middleware";
import { parseBody, chatSendSchema } from "@/lib/schemas";
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

  // Rate limits — skip if kill switch is enabled
  const rateLimitsDisabled = process.env.VISIONQUEST_DISABLE_RATE_LIMITS === "true";
  let dailyRemaining: number | null = null;

  if (!rateLimitsDisabled) {
    // Hourly limit by role
    const hourlyLimit = isTeacher ? (session.role === "admin" ? 120 : 60) : 40;
    const hourlyRl = await rateLimit(`chat:${session.id}`, hourlyLimit, 60 * 60 * 1000);
    if (!hourlyRl.success) {
      return new Response(
        JSON.stringify({ error: "Too many messages this hour. Please wait before sending more." }),
        { status: 429 },
      );
    }

    // Daily limit by role (calendar-day, resets midnight UTC)
    if (session.role !== "admin") {
      const dailyLimit = isTeacher ? 400 : 200;
      const dailyRl = await rateLimitDaily(`chat-daily:${session.id}`, dailyLimit);
      if (!dailyRl.success) {
        return new Response(
          JSON.stringify({ error: "I've reached my daily limit. I'll be fresh and ready tomorrow! For urgent questions, please ask your instructor." }),
          { status: 429 },
        );
      }
      dailyRemaining = dailyRl.remaining;
    }
  }

  // Check token quota before making AI call
  const quota = await checkTokenQuota(session.id, session.role);
  if (!quota.allowed) {
    return new Response(
      JSON.stringify({ error: quota.warning }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  // Resolve AI provider
  let provider;
  try {
    provider = await getProvider(session.id);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "AI provider unavailable";
    const isOffline = errorMsg.includes("Local AI server") || errorMsg.includes("not configured");

    return new Response(
      JSON.stringify({
        error: isOffline
          ? "Sage is offline right now. The local AI server is not reachable. Please try again later."
          : errorMsg,
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  // Get or create conversation (teacher vs student path)
  const conversation = isTeacher
    ? await getOrCreateTeacherConversation(session.id, conversationId)
    : await getOrCreateConversation(session.id, conversationId, requestedStage);

  // Save user message
  await saveMessage(conversation.id, session.id, "user", userMessage);

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
  const documentContext = await getDocumentContext(userMessage, isTeacher ? "staff" : "student");
  if (documentContext) {
    systemPrompt += documentContext;
  }

  // 80% daily warning — inject into system prompt so Sage mentions it naturally
  if (dailyRemaining !== null) {
    const dailyLimit = isStaffRole(session.role) ? 400 : 200;
    const usagePercent = 1 - (dailyRemaining / dailyLimit);
    if (usagePercent >= 0.8) {
      systemPrompt += `\n\n[SYSTEM NOTE: This user has used ${Math.round(usagePercent * 100)}% of their daily message limit. Naturally mention that you're getting a lot of questions today and your answers may be shorter for a bit. Do not make it alarming.]`;
    }
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

        for await (const chunk of provider.streamResponse(systemPrompt, allMessages)) {
          fullResponse += chunk;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
        }

        // Save assistant message
        await saveMessage(conversation.id, session.id, "assistant", fullResponse);

        // Rolling summary compaction (fire-and-forget, both teacher and student)
        void maybeUpdateSummary(conversation.id, session.id).catch((err) =>
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
