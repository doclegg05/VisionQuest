import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { streamResponse } from "@/lib/gemini";
import { decrypt } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { buildSystemPrompt, determineStage, ConversationStage } from "@/lib/sage/system-prompts";
import { extractGoals } from "@/lib/sage/goal-extractor";
import { parseState, createInitialState, recordGoalSet, recordChatSession, recordWeeklyReview, recordMonthlyReview } from "@/lib/progression/engine";
import { logger } from "@/lib/logger";
import { invalidatePrefix } from "@/lib/cache";
import { withAuth } from "@/lib/api-error";

const PLATFORM_GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

async function getOrCreateProgression(studentId: string) {
  const existing = await prisma.progression.findUnique({ where: { studentId } });
  if (existing) return parseState(existing.state);
  const initial = createInitialState();
  await prisma.progression.create({
    data: { studentId, state: JSON.stringify(initial) },
  });
  return initial;
}

async function saveProgression(studentId: string, state: ReturnType<typeof createInitialState>) {
  await prisma.progression.upsert({
    where: { studentId },
    update: { state: JSON.stringify(state) },
    create: { studentId, state: JSON.stringify(state) },
  });
  invalidatePrefix(`progression:${studentId}`);
}

export const POST = withAuth(async (session, req: NextRequest) => {
  const body = await req.json();
  const userMessage = (body.message || "").trim();
  const conversationId = body.conversationId || null;

  if (!userMessage) {
    return new Response(JSON.stringify({ error: "Message is required." }), { status: 400 });
  }

  if (userMessage.length > 10000) {
    return new Response(JSON.stringify({ error: "Message too long. Maximum 10,000 characters." }), { status: 400 });
  }

  const rl = await rateLimit(`chat:${session.id}`, 60, 60 * 60 * 1000);
  if (!rl.success) {
    return new Response(JSON.stringify({ error: "Too many messages. Please wait before sending more." }), { status: 429 });
  }

  // Get student's API key
  const student = await prisma.student.findUnique({
    where: { id: session.id },
    select: { geminiApiKey: true },
  });

  if (!student?.geminiApiKey && !PLATFORM_GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Sage is not configured yet. Add a personal Gemini API key in Settings or ask staff to configure the platform key." }),
      { status: 400 }
    );
  }

  let apiKey: string;
  if (student?.geminiApiKey) {
    try {
      apiKey = decrypt(student.geminiApiKey);
    } catch {
      // Key failed to decrypt — require re-entry rather than using raw value
      return new Response(
        JSON.stringify({ error: "Your API key needs to be re-entered. Please update it in Settings." }),
        { status: 400 },
      );
    }
  } else {
    apiKey = PLATFORM_GEMINI_API_KEY;
  }

  // Get or create conversation
  let conversation;
  if (conversationId) {
    conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, studentId: session.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) {
      return new Response(JSON.stringify({ error: "Conversation not found." }), { status: 404 });
    }
  } else {
    const goals = await prisma.goal.findMany({
      where: { studentId: session.id, status: "active" },
      select: { level: true },
    });
    const stage = determineStage(goals);

    // Deactivate previous conversations of the same module
    await prisma.conversation.updateMany({
      where: { studentId: session.id, module: "goal", active: true },
      data: { active: false },
    });

    conversation = await prisma.conversation.create({
      data: {
        studentId: session.id,
        module: "goal",
        stage,
        active: true,
      },
      include: { messages: true },
    });
  }

  // Save user message to DB
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: userMessage,
    },
  });

  // Build context for system prompt
  const goals = await prisma.goal.findMany({
    where: { studentId: session.id, status: "active" },
  });

  const goalsByLevel: Record<string, string> = {};
  for (const g of goals) {
    goalsByLevel[g.level] = g.content;
  }

  const goalsSummary = goals.length > 0
    ? goals.map((g) => `- ${g.level.toUpperCase()}: ${g.content}`).join("\n")
    : "No goals set yet.";

  const systemPrompt = buildSystemPrompt(conversation.stage as ConversationStage, {
    studentName: session.displayName,
    bhag: goalsByLevel["bhag"],
    monthly: goalsByLevel["monthly"],
    weekly: goalsByLevel["weekly"],
    daily: goalsByLevel["daily"],
    goals_summary: goalsSummary,
    userMessage,
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
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            role: "assistant",
            content: fullResponse,
          },
        });

        // Award chat session XP
        const progState = await getOrCreateProgression(session.id);
        recordChatSession(progState);
        await saveProgression(session.id, progState);

        // Run goal extraction asynchronously
        extractGoals(
          apiKey,
          [...allMessages, { role: "model" as const, content: fullResponse }],
          conversation.stage
        ).then(async (extracted) => {
          // Batch-fetch existing active goals to avoid N+1 queries
          const existingGoals = await prisma.goal.findMany({
            where: { studentId: session.id, status: "active" },
            select: { level: true },
          });
          const existingLevels = new Set(existingGoals.map(g => g.level));

          const newGoals: string[] = [];

          for (const goal of extracted.goals_found) {
            if (!existingLevels.has(goal.level)) {
              try {
                await prisma.goal.create({
                  data: {
                    studentId: session.id,
                    level: goal.level,
                    content: goal.content,
                    status: "active",
                  },
                });
                newGoals.push(goal.level);
                existingLevels.add(goal.level);
              } catch (err) {
                logger.error("Failed to create goal", { level: goal.level, error: String(err) });
              }
            }
          }

          if (newGoals.length > 0) {
            invalidatePrefix(`goals:${session.id}`);
          }

          // Award XP for new goals
          if (newGoals.length > 0) {
            try {
              const state = await getOrCreateProgression(session.id);
              for (const level of newGoals) {
                recordGoalSet(state, level);
              }
              await saveProgression(session.id, state);
            } catch (err) {
              logger.error("Failed to save progression for new goals", { error: String(err) });
            }
          }

          // Update conversation stage if needed
          if (extracted.stage_complete) {
            try {
              const updatedGoals = await prisma.goal.findMany({
                where: { studentId: session.id, status: "active" },
                select: { level: true },
              });
              const newStage = determineStage(updatedGoals);
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { stage: newStage },
              });
            } catch (err) {
              logger.error("Failed to update conversation stage", { error: String(err) });
            }
          }

          // Award XP for review conversations
          if (conversation.stage === "review") {
            try {
              const reviewState = await getOrCreateProgression(session.id);
              const reviewMsgCount = await prisma.message.count({
                where: { conversationId: conversation.id },
              });
              if (reviewMsgCount >= 4) {
                const hasMonthlyGoal = existingLevels.has("monthly");
                const hasWeeklyGoal = existingLevels.has("weekly");
                if (hasMonthlyGoal && hasWeeklyGoal) {
                  recordWeeklyReview(reviewState);
                } else if (hasMonthlyGoal) {
                  recordMonthlyReview(reviewState);
                }
                await saveProgression(session.id, reviewState);
              }
            } catch (err) {
              logger.error("Failed to record review XP", { error: String(err) });
            }
          }

          // Generate conversation title from first exchange
          try {
            const msgCount = await prisma.message.count({
              where: { conversationId: conversation.id },
            });
            if (msgCount <= 4 && !conversation.title) {
              const titleSummary = fullResponse.slice(0, 60).replace(/\n/g, " ").trim();
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { title: titleSummary + (titleSummary.length >= 60 ? "..." : "") },
              });
            }
          } catch (err) {
            logger.error("Failed to generate conversation title", { error: String(err) });
          }
        }).catch((err) => logger.error("Goal extraction error", { error: String(err) }));

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, conversationId: conversation.id })}\n\n`));
        controller.close();
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const errName = error instanceof Error ? error.name : "Unknown";
        logger.error("Stream error", { name: errName, message: errMsg, error: String(error) });
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
