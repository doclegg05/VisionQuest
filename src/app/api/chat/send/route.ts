import { getPromptTier, resolveAiProvider, type AIProvider } from "@/lib/ai";
import { getProviderClass, logAiAuditEvent } from "@/lib/ai/audit";
import { rateLimit, rateLimitDaily } from "@/lib/rate-limit";
import { buildSystemPrompt, ConversationStage } from "@/lib/sage/system-prompts";
import { getDocumentContext } from "@/lib/sage/knowledge-base-server";
import { getDirectFormAnswer, getFormContext } from "@/lib/sage/knowledge-base";
import { recordChatSession } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { logger } from "@/lib/logger";
import { isStaffRole } from "@/lib/api-error";
import { withRegistry } from "@/lib/registry/middleware";
import { parseBody, chatSendSchema } from "@/lib/schemas";
import { getOrCreateConversation, getOrCreateTeacherConversation, saveMessage, getConversationContext, maybeUpdateSummary } from "@/lib/chat/conversation";
import { handlePostResponse } from "@/lib/chat/post-response";
import { getStudentPromptContext } from "@/lib/chat/context";
import { formatChatSseComment, formatChatSseEvent } from "@/lib/chat/sse";
import { buildStaffStudentContext } from "@/lib/sage/staff-student-context";
import { formatClustersForPrompt } from "@/lib/spokes/career-clusters";
import { checkTokenQuota } from "@/lib/llm-usage";
import { prisma } from "@/lib/db";
import { type ProgramType } from "@/lib/program-type";
import { getStudentProgramType } from "@/lib/program-type-server";

// ─── Route handler ──────────────────────────────────────────────────────────

const CHAT_SSE_HEARTBEAT_MS = 15_000;

class ChatSseClientClosedError extends Error {
  constructor() {
    super("Client disconnected before Sage completed streaming.");
    this.name = "ChatSseClientClosedError";
  }
}

function createSseResponse(
  conversationId: string,
  text: string,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(formatChatSseEvent({ conversationId })),
      );
      controller.enqueue(
        encoder.encode(formatChatSseEvent({ text })),
      );
      controller.enqueue(
        encoder.encode(formatChatSseEvent({ done: true, conversationId })),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const POST = withRegistry("sage.chat", async (session, req, _ctx, _tool) => {
  const body = await parseBody(req, chatSendSchema);
  const userMessage = body.message.trim();
  const conversationId = body.conversationId || null;
  const requestedStage = body.requestedStage;
  const isTeacher = isStaffRole(session.role);
  const chatTask = isTeacher ? "sage_staff_chat" : "sage_student_chat";
  const chatSensitivity = isTeacher ? "staff_entered" : "student_record";
  const directFormAnswer = getDirectFormAnswer(userMessage);

  if (directFormAnswer) {
    const conversation = isTeacher
      ? await getOrCreateTeacherConversation(session.id, conversationId)
      : await getOrCreateConversation(session.id, conversationId, requestedStage);

    await saveMessage(conversation.id, session.id, "user", userMessage);
    await saveMessage(conversation.id, session.id, "assistant", directFormAnswer);
    await logAiAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      route: "/api/chat/send",
      task: "public_form_lookup",
      sensitivity: "public_program",
      policyDecision: "direct_no_model",
      status: "direct",
      targetId: conversation.id,
      providerName: null,
      providerClass: "none",
      allowCloud: true,
      inputChars: userMessage.length,
      outputChars: directFormAnswer.length,
      reason: "Matched a public blank-form request in the deterministic SPOKES form registry.",
    });

    return createSseResponse(conversation.id, directFormAnswer);
  }

  // Resolve AI provider first — guardrails depend on whether it's cloud or local.
  // Student-record and staff-entered chat are local-only; public form lookup
  // bypasses this route above.
  let provider: AIProvider;
  try {
    provider = await resolveAiProvider({
      studentId: session.id,
      task: chatTask,
      sensitivity: chatSensitivity,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "AI provider unavailable";
    const isOffline = errorMsg.includes("Local AI server") || errorMsg.includes("not configured");

    logger.error("AI provider initialization failed", { error: errorMsg, studentId: session.id });
    await logAiAuditEvent({
      actorId: session.id,
      actorRole: session.role,
      route: "/api/chat/send",
      task: chatTask,
      sensitivity: chatSensitivity,
      policyDecision: "blocked",
      status: "blocked",
      targetId: conversationId,
      providerName: null,
      providerClass: "none",
      allowCloud: false,
      inputChars: userMessage.length,
      reason: errorMsg,
      errorCode: isOffline ? "LOCAL_AI_UNAVAILABLE" : "AI_PROVIDER_UNAVAILABLE",
    });

    return new Response(
      JSON.stringify({
        error: isOffline
          ? "Sage is offline right now. The local AI server is not reachable. Please try again later."
          : "Sage is temporarily unavailable. Please try again in a moment.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
  const promptTier = getPromptTier(provider);
  const providerClass = getProviderClass(provider.name);
  await logAiAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    route: "/api/chat/send",
    task: chatTask,
    sensitivity: chatSensitivity,
    policyDecision: "local_only",
    status: "routed",
    targetId: conversationId,
    providerName: provider.name,
    providerClass,
    promptTier,
    allowCloud: false,
    inputChars: userMessage.length,
    reason: "Student-record and staff-entered Sage chat are local-only by policy.",
  });

  // All token/rate guardrails only apply to cloud providers (local models have no API cost)
  const isCloudProvider = provider.name === "gemini";
  const rateLimitsDisabled = process.env.VISIONQUEST_DISABLE_RATE_LIMITS === "true";
  let dailyRemaining: number | null = null;

  if (isCloudProvider && !rateLimitsDisabled) {
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

  // Token quota only applies to cloud providers
  const quota = isCloudProvider
    ? await checkTokenQuota(session.id, session.role)
    : { allowed: true, warning: null };
  if (!quota.allowed) {
    return new Response(
      JSON.stringify({ error: quota.warning }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  // Get or create conversation (teacher vs student path)
  const conversation = isTeacher
    ? await getOrCreateTeacherConversation(session.id, conversationId)
    : await getOrCreateConversation(session.id, conversationId, requestedStage);
  const conversationStage = conversation.stage as ConversationStage;

  // Save user message
  await saveMessage(conversation.id, session.id, "user", userMessage);

  let staffStudentContext: string | null = null;
  let staffStudentTargetId: string | null = null;
  let staffStudentContextResolution: "none" | "resolved" | "ambiguous" | "not_found" = "none";
  if (isTeacher) {
    const priorUserMessages = (conversation.messages ?? [])
      .filter((message) => message.role === "user")
      .map((message) => message.content);
    const contextResult = await buildStaffStudentContext(session, {
      userMessage,
      priorUserMessages,
      targetStudentId: body.targetStudentId,
    });
    staffStudentContext = contextResult.context;
    staffStudentTargetId = contextResult.targetStudentId;
    staffStudentContextResolution = contextResult.resolution;
  }

  // Fetch program context once for students — reused by both the system
  // prompt and the post-response handler.
  let studentProgramType: ProgramType | null = null;
  let studentClassroomConfirmedAt: Date | null = null;
  if (!isTeacher) {
    const [programType, studentRecord] = await Promise.all([
      getStudentProgramType(session.id),
      prisma.student.findUnique({
        where: { id: session.id },
        select: { classroomConfirmedAt: true },
      }),
    ]);
    studentProgramType = programType;
    studentClassroomConfirmedAt = studentRecord?.classroomConfirmedAt ?? null;
  }

  // Build system prompt — teacher gets a streamlined path
  let systemPrompt: string;

  if (isTeacher) {
    systemPrompt = buildSystemPrompt("teacher_assistant", {
      studentName: session.displayName,
      userMessage,
      staffStudentContext,
    }, promptTier);
  } else {
    const promptContext = await getStudentPromptContext(
      session.id,
      conversation.id,
      conversationStage,
      promptTier === "compact" ? 1 : 3,
    );

    systemPrompt =
      promptContext.priorConversationContext +
      buildSystemPrompt(conversationStage, {
        studentName: session.displayName,
        programType: studentProgramType,
        classroomConfirmedAt: studentClassroomConfirmedAt,
        bhag: promptContext.goalsByLevel["bhag"],
        monthly: promptContext.goalsByLevel["monthly"],
        weekly: promptContext.goalsByLevel["weekly"],
        daily: promptContext.goalsByLevel["daily"],
        goals_summary: promptContext.goalsSummary,
        student_status_summary: promptContext.studentStatusSummary,
        userMessage,
        career_clusters:
          conversationStage === "discovery"
            ? formatClustersForPrompt()
            : undefined,
        discovery_summary: promptContext.discoverySummary,
        career_profile_context: promptContext.careerProfileContext,
        skillGapContext: promptContext.skillGapContext,
        pathwayContext: promptContext.pathwayContext,
        coachingArcContext: promptContext.coachingArcContext,
      }, promptTier);
  }

  // Inject document-based context from ProgramDocument (RAG layer)
  const documentContext = await getDocumentContext(
    userMessage,
    isTeacher ? "staff" : "student",
    3,
    promptTier === "compact" ? 2000 : 6000,
  );
  if (documentContext) {
    systemPrompt += documentContext;
  }
  const formContext = getFormContext(userMessage);
  if (formContext) {
    systemPrompt += formContext;
  }

  // 80% daily warning — inject into system prompt so Sage mentions it naturally
  if (dailyRemaining !== null) {
    const dailyLimit = isStaffRole(session.role) ? 400 : 200;
    const usagePercent = 1 - (dailyRemaining / dailyLimit);
    if (usagePercent >= 0.8) {
      systemPrompt += `\n\n[SYSTEM NOTE: This user has used ${Math.round(usagePercent * 100)}% of their daily message limit. Naturally mention that you're getting a lot of questions today and your answers may be shorter for a bit. Do not make it alarming.]`;
    }
  }

  // Log assembled prompt size for before/after comparison in Render logs.
  // Remove in a follow-up PR once baseline data is collected.
  logger.info("sage.prompt.size", { size: systemPrompt.length });

  // Format message history for Gemini, using compacted context when available
  const maxRecentMessages =
    promptTier === "compact"
      ? conversationStage === "discovery" ||
        conversationStage === "career_profile_review"
        ? 12
        : 6
      : 20;
  const conversationContext = await getConversationContext(
    conversation.id,
    maxRecentMessages,
  );
  const allMessages = [
    ...conversationContext.messages,
    { role: "user" as const, content: userMessage },
  ];

  // Stream response via SSE
  // Local (Ollama) providers MUST use streaming: Cloudflare Tunnel returns 524
  // if the origin takes >100s to send the first byte. With stream:true, Ollama
  // emits the first token within seconds, keeping the tunnel alive. With
  // stream:false, the entire generation must complete before any bytes flow,
  // which exceeds the tunnel timeout for large prompts on big models.
  const useNonStreaming = false;
  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      let streamClosed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

      const enqueueSse = (payload: string, label: string): boolean => {
        if (streamClosed) return false;
        try {
          controller.enqueue(encoder.encode(payload));
          return true;
        } catch (error) {
          streamClosed = true;
          logger.warn("Chat SSE stream closed before enqueue", {
            conversationId: conversation.id,
            label,
            error: String(error),
          });
          return false;
        }
      };

      const sendEvent = (event: Parameters<typeof formatChatSseEvent>[0], label: string): void => {
        if (!enqueueSse(formatChatSseEvent(event), label)) {
          throw new ChatSseClientClosedError();
        }
      };

      const stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      const closeStream = () => {
        stopHeartbeat();
        if (streamClosed) return;
        try {
          controller.close();
        } catch (error) {
          logger.warn("Chat SSE stream was already closed", {
            conversationId: conversation.id,
            error: String(error),
          });
        } finally {
          streamClosed = true;
        }
      };

      heartbeatTimer = setInterval(() => {
        if (!enqueueSse(formatChatSseComment("keep-alive"), "heartbeat")) {
          stopHeartbeat();
        }
      }, CHAT_SSE_HEARTBEAT_MS);

      try {
        sendEvent({ conversationId: conversation.id }, "conversationId");

        // Send soft-cap warning as an SSE event before the AI response
        if (quota.warning) {
          sendEvent({ quotaWarning: quota.warning }, "quotaWarning");
        }

        if (useNonStreaming) {
          fullResponse = await provider.generateResponse(systemPrompt, allMessages);
          sendEvent({ text: fullResponse }, "text");
        } else {
          for await (const chunk of provider.streamResponse(systemPrompt, allMessages)) {
            fullResponse += chunk;
            sendEvent({ text: chunk }, "text");
          }
        }

        // Save assistant message (truncate to avoid unbounded DB writes if the
        // model goes off the rails — 40k chars ≈ 10k tokens, generous ceiling).
        const MAX_ASSISTANT_CHARS = 40_000;
        const persisted = fullResponse.length > MAX_ASSISTANT_CHARS
          ? fullResponse.slice(0, MAX_ASSISTANT_CHARS) + "\n[…truncated by server — response exceeded length cap]"
          : fullResponse;
        if (persisted.length !== fullResponse.length) {
          logger.warn("Assistant message truncated before persist", {
            conversationId: conversation.id,
            original: fullResponse.length,
            persisted: persisted.length,
          });
        }
        await saveMessage(conversation.id, session.id, "assistant", persisted);
        await logAiAuditEvent({
          actorId: session.id,
          actorRole: session.role,
          route: "/api/chat/send",
          task: chatTask,
          sensitivity: chatSensitivity,
          policyDecision: "local_only",
          status: "completed",
          targetId: conversation.id,
          providerName: provider.name,
          providerClass,
          promptTier,
          allowCloud: false,
          inputChars: userMessage.length,
          outputChars: persisted.length,
          metadata: {
            conversationStage,
            staffStudentContextResolution,
            staffStudentTargetId,
          },
        });

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
            userMessage,
            programType: studentProgramType,
            classroomConfirmedAt: studentClassroomConfirmedAt,
          }).catch((err) => logger.error("Post-response error", { error: String(err) }));
        }

        sendEvent({ done: true, conversationId: conversation.id }, "done");
        closeStream();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const cause = error instanceof Error && error.cause ? String(error.cause) : undefined;
        const clientClosed = error instanceof ChatSseClientClosedError || streamClosed;
        const errorCode = clientClosed ? "CLIENT_STREAM_CLOSED" : "AI_STREAM_FAILED";
        const logPayload = { error: msg, cause, provider: provider.name };
        if (clientClosed) {
          logger.warn("Chat SSE client disconnected", logPayload);
        } else {
          logger.error("Stream error", logPayload);
        }
        await logAiAuditEvent({
          actorId: session.id,
          actorRole: session.role,
          route: "/api/chat/send",
          task: chatTask,
          sensitivity: chatSensitivity,
          policyDecision: "local_only",
          status: "failed",
          targetId: conversation.id,
          providerName: provider.name,
          providerClass,
          promptTier,
          allowCloud: false,
          inputChars: userMessage.length,
          outputChars: fullResponse.length,
          reason: msg,
          errorCode,
          metadata: {
            conversationStage,
            staffStudentContextResolution,
            staffStudentTargetId,
          },
        });
        if (!clientClosed) {
          try {
            sendEvent({ error: `AI streaming failed: ${msg}${cause ? ` (${cause})` : ""}` }, "error");
          } catch {
            // The client went away while we were reporting the original error.
          }
        }
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
