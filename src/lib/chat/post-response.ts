import { prisma } from "@/lib/db";
import { ensureGoalLevelProgression } from "@/lib/goal-progression";
import { GOAL_PLANNING_STATUSES, isGoalLevel, type GoalLevel } from "@/lib/goals";
import { extractGoals } from "@/lib/sage/goal-extractor";
import { determineStage } from "@/lib/sage/system-prompts";
import {
  parseState,
  createInitialState,
  recordWeeklyReview,
  recordMonthlyReview,
} from "@/lib/progression/engine";
import { logger } from "@/lib/logger";
import { invalidatePrefix } from "@/lib/cache";
import { generateConversationTitle } from "./conversation";

// ─── Progression helpers (private) ──────────────────────────────────────────

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

// ─── Main post-response handler ─────────────────────────────────────────────

interface PostResponseParams {
  conversationId: string;
  conversationTitle: string | null;
  conversationStage: string;
  fullResponse: string;
  studentId: string;
  apiKey: string;
  allMessages: { role: "user" | "model"; content: string }[];
}

/**
 * Handles all side effects after the AI response stream completes.
 * Runs asynchronously (fire-and-forget from the route).
 *
 * Steps:
 * 1. Extract goals from conversation
 * 2. Create new goal records
 * 3. Award XP for new goals
 * 4. Update conversation stage if stage_complete
 * 5. Award review XP for review conversations
 * 6. Generate conversation title
 */
export async function handlePostResponse({
  conversationId,
  conversationTitle,
  conversationStage,
  fullResponse,
  studentId,
  apiKey,
  allMessages,
}: PostResponseParams): Promise<void> {
  // 1. Extract goals
  const extracted = await extractGoals(
    apiKey,
    [...allMessages, { role: "model" as const, content: fullResponse }],
    conversationStage,
  );

  // 2. Create new goal records
  const existingGoals = await prisma.goal.findMany({
    where: { studentId, status: { in: [...GOAL_PLANNING_STATUSES] } },
    select: { level: true },
  });
  const existingLevels = new Set(existingGoals.map((g) => g.level));
  const newGoals: GoalLevel[] = [];

  for (const goal of extracted.goals_found) {
    const content = goal.content.trim();
    if (!isGoalLevel(goal.level) || !content) {
      continue;
    }

    if (!existingLevels.has(goal.level)) {
      try {
        await prisma.goal.create({
          data: { studentId, level: goal.level, content, status: "active" },
        });
        newGoals.push(goal.level);
        existingLevels.add(goal.level);
      } catch (err) {
        logger.error("Failed to create goal", { level: goal.level, error: String(err) });
      }
    }
  }

  if (newGoals.length > 0) {
    invalidatePrefix(`goals:${studentId}`);
  }

  // 3. Award XP for new goals
  if (newGoals.length > 0) {
    try {
      await ensureGoalLevelProgression(studentId, newGoals);
    } catch (err) {
      logger.error("Failed to save progression for new goals", { error: String(err) });
    }
  }

  // 4. Update conversation stage if needed
  if (extracted.stage_complete) {
    try {
      const updatedGoals = await prisma.goal.findMany({
        where: { studentId, status: { in: [...GOAL_PLANNING_STATUSES] } },
        select: { level: true },
      });
      const newStage = determineStage(updatedGoals);
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { stage: newStage },
      });
    } catch (err) {
      logger.error("Failed to update conversation stage", { error: String(err) });
    }
  }

  // 5. Award review XP
  if (conversationStage === "review") {
    try {
      const reviewState = await getOrCreateProgression(studentId);
      const reviewMsgCount = await prisma.message.count({ where: { conversationId } });
      if (reviewMsgCount >= 4) {
        const hasMonthly = existingLevels.has("monthly");
        const hasWeekly = existingLevels.has("weekly");
        if (hasMonthly && hasWeekly) {
          recordWeeklyReview(reviewState);
        } else if (hasMonthly) {
          recordMonthlyReview(reviewState);
        }
        await saveProgression(studentId, reviewState);
      }
    } catch (err) {
      logger.error("Failed to record review XP", { error: String(err) });
    }
  }

  // 6. Generate conversation title
  try {
    await generateConversationTitle(conversationId, fullResponse, conversationTitle);
  } catch (err) {
    logger.error("Failed to generate conversation title", { error: String(err) });
  }
}
