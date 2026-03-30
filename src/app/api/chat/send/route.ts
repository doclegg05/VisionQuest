import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { streamResponse } from "@/lib/gemini";
import { rateLimit } from "@/lib/rate-limit";
import { buildSystemPrompt, ConversationStage } from "@/lib/sage/system-prompts";
import { getDocumentContext } from "@/lib/sage/knowledge-base";
import { recordChatSession } from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { logger } from "@/lib/logger";
import { withAuth, isStaffRole } from "@/lib/api-error";
import { parseBody, chatSendSchema } from "@/lib/schemas";
import { resolveApiKey } from "@/lib/chat/api-key";
import { getOrCreateConversation, getOrCreateTeacherConversation, saveMessage } from "@/lib/chat/conversation";
import { handlePostResponse } from "@/lib/chat/post-response";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import { buildStudentStatusSignals, buildStudentStatusSummary } from "@/lib/student-status";
import { formatClustersForPrompt } from "@/lib/spokes/career-clusters";
import { analyzeSkillGaps } from "@/lib/sage/skill-gap";
import { getLearningPathway, buildPathwayContextString } from "@/lib/learning-pathway";
import { getOrCreateCoachingArc, buildArcContextString } from "@/lib/sage/coaching-arcs";

// ─── Route handler ──────────────────────────────────────────────────────────

export const POST = withAuth(async (session, req: NextRequest) => {
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

  // Resolve API key
  const apiKey = await resolveApiKey(session.id);

  // Get or create conversation (teacher vs student path)
  const conversation = isTeacher
    ? await getOrCreateTeacherConversation(session.id, conversationId)
    : await getOrCreateConversation(session.id, conversationId, requestedStage);

  // Save user message
  await saveMessage(conversation.id, "user", userMessage);

  // Build system prompt — teacher gets a streamlined path
  let systemPrompt: string;

  if (isTeacher) {
    systemPrompt = buildSystemPrompt("teacher_assistant", {
      studentName: session.displayName,
      userMessage,
    });
  } else {
    const [goals, orientationItems, formSubmissions, orientationProgress, careerDiscovery, priorSummaries] = await Promise.all([
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
        select: {
          status: true,
          sageSummary: true,
          topClusters: true,
          hollandCode: true,
          riasecScores: true,
          nationalClusters: true,
          transferableSkills: true,
          workValues: true,
        },
      }),
      prisma.conversation.findMany({
        where: {
          studentId: session.id,
          id: { not: conversation.id },
          summary: { not: null },
        },
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: { summary: true, module: true, updatedAt: true },
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

    // Build skill gap context for goal-setting stages
    const goalSettingStages = ["bhag", "monthly", "weekly", "daily"];
    let skillGapContext: string | undefined;
    if (goalSettingStages.includes(conversation.stage) && careerDiscovery?.status === "complete") {
      try {
        const gapAnalysis = await analyzeSkillGaps(session.id);
        if (gapAnalysis) {
          const haveList = gapAnalysis.skills
            .filter((s) => s.status === "have")
            .map((s) => s.name)
            .join(", ");
          const buildingList = gapAnalysis.skills
            .filter((s) => s.status === "building")
            .map((s) => `${s.name} (via ${s.buildingVia ?? "certification"})`)
            .join(", ");
          const needList = gapAnalysis.skills
            .filter((s) => s.status === "need" && s.importance === "essential")
            .map((s) => s.name)
            .join(", ");
          skillGapContext = [
            `SKILL GAP ANALYSIS for ${gapAnalysis.targetClusterName}:`,
            haveList ? `The student HAS these skills: ${haveList}.` : "",
            buildingList ? `They are BUILDING: ${buildingList}.` : "",
            needList
              ? `They NEED (essential gaps): ${needList}. When setting goals, prioritize closing these essential skill gaps.`
              : "No essential skill gaps — focus on reinforcing and applying existing skills.",
          ]
            .filter(Boolean)
            .join(" ");
        }
      } catch {
        // Skill gap analysis is non-critical — never block the chat response
      }
    }

    // Build pathway context for action-oriented stages
    const pathwayStages = ["daily", "weekly", "tasks"];
    let pathwayContext: string | undefined;
    if (pathwayStages.includes(conversation.stage)) {
      try {
        const pathway = await getLearningPathway(session.id);
        if (pathway) {
          pathwayContext = buildPathwayContextString(pathway);
        }
      } catch {
        // Pathway context is non-critical — never block the chat response
      }
    }

    // Build coaching arc context — injected into all stages
    let coachingArcContext: string | undefined;
    try {
      const arc = await getOrCreateCoachingArc(session.id);
      if (arc.status === "active") {
        coachingArcContext = buildArcContextString(arc);
      }
    } catch {
      // Arc context is non-critical — never block chat response
    }

    // Build career profile context for profile review stage
    let careerProfileContext: string | undefined;
    if (conversation.stage === "career_profile_review" && careerDiscovery?.status === "complete") {
      const parts: string[] = [];
      if (careerDiscovery.hollandCode) {
        parts.push(`Holland Code: ${careerDiscovery.hollandCode}`);
      }
      if (careerDiscovery.riasecScores) {
        try {
          const scores = JSON.parse(careerDiscovery.riasecScores) as Record<string, number>;
          const scoreLines = Object.entries(scores)
            .sort(([, a], [, b]) => b - a)
            .map(([k, v]) => `  ${k}: ${Math.round(v * 100)}%`)
            .join("\n");
          parts.push(`RIASEC Scores:\n${scoreLines}`);
        } catch {
          // malformed JSON — skip
        }
      }
      if (careerDiscovery.transferableSkills) {
        try {
          const skills = JSON.parse(careerDiscovery.transferableSkills) as Array<{ skill: string; category: string; evidence: string }>;
          if (skills.length > 0) {
            const skillLines = skills.map((s) => `  - ${s.skill} (${s.category}): ${s.evidence}`).join("\n");
            parts.push(`Transferable Skills:\n${skillLines}`);
          }
        } catch {
          // malformed JSON — skip
        }
      }
      if (careerDiscovery.workValues) {
        try {
          const values = JSON.parse(careerDiscovery.workValues) as Array<{ value: string; importance: string }>;
          if (values.length > 0) {
            const valueLines = values.slice(0, 5).map((v) => `  - ${v.value} (${v.importance})`).join("\n");
            parts.push(`Work Values:\n${valueLines}`);
          }
        } catch {
          // malformed JSON — skip
        }
      }
      if (careerDiscovery.nationalClusters) {
        try {
          const clusters = JSON.parse(careerDiscovery.nationalClusters) as Array<{ cluster_name: string; score: number }>;
          if (clusters.length > 0) {
            const top3 = clusters.slice().sort((a, b) => b.score - a.score).slice(0, 3);
            const clusterLines = top3.map((c) => `  - ${c.cluster_name} (${Math.round(c.score * 100)}% match)`).join("\n");
            parts.push(`Top Career Clusters:\n${clusterLines}`);
          }
        } catch {
          // malformed JSON — skip
        }
      }
      if (careerDiscovery.sageSummary) {
        parts.push(`Assessment Summary: ${careerDiscovery.sageSummary}`);
      }
      careerProfileContext = parts.join("\n\n");
    }

    // Build prior conversation context block from summaries of recent other sessions
    let priorConversationContext = "";
    if (priorSummaries.length > 0) {
      const lines = priorSummaries.map((s) => {
        const date = s.updatedAt.toISOString().slice(0, 10);
        return `Session from ${date} (${s.module}): ${s.summary}`;
      });
      priorConversationContext =
        `[PREVIOUS_CONVERSATIONS_START]\n${lines.join("\n")}\n[PREVIOUS_CONVERSATIONS_END]\n\n`;
    }

    systemPrompt =
      priorConversationContext +
      buildSystemPrompt(conversation.stage as ConversationStage, {
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
        career_profile_context: careerProfileContext,
        skillGapContext,
        pathwayContext,
        coachingArcContext,
      });
  }

  // Inject document-based context from ProgramDocument (RAG layer)
  const documentContext = await getDocumentContext(userMessage);
  if (documentContext) {
    systemPrompt += documentContext;
  }

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
            conversationSummary: conversation.summary ?? null,
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
