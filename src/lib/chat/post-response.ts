import { prisma } from "@/lib/db";
import { ensureGoalLevelProgression } from "@/lib/goal-progression";
import { GOAL_PLANNING_STATUSES, isGoalLevel, type GoalLevel } from "@/lib/goals";
import { extractGoals } from "@/lib/sage/goal-extractor";
import { extractDiscoverySignals, topClusterIds } from "@/lib/sage/discovery-extractor";
import { determineStage } from "@/lib/sage/system-prompts";
import {
  recordWeeklyReview,
  recordMonthlyReview,
} from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { logger } from "@/lib/logger";
import { invalidatePrefix } from "@/lib/cache";
import { generateConversationTitle } from "./conversation";

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
  // 0. Discovery extraction (runs instead of goal extraction during discovery)
  if (conversationStage === "discovery") {
    try {
      const discoveryResult = await extractDiscoverySignals(
        apiKey,
        [...allMessages, { role: "model" as const, content: fullResponse }],
      );

      // Upsert CareerDiscovery record with latest signals
      const upsertData = {
        interests: JSON.stringify(discoveryResult.interests),
        strengths: JSON.stringify(discoveryResult.strengths),
        subjects: JSON.stringify(discoveryResult.subjects),
        problems: JSON.stringify(discoveryResult.problems),
        values: JSON.stringify(discoveryResult.values),
        circumstances: JSON.stringify(discoveryResult.circumstances),
        clusterScores: JSON.stringify(discoveryResult.cluster_scores),
        sageSummary: discoveryResult.summary || null,
        riasecScores: JSON.stringify(discoveryResult.riasec_scores),
        hollandCode: discoveryResult.holland_code || null,
        nationalClusters: JSON.stringify(discoveryResult.national_career_clusters),
        transferableSkills: JSON.stringify(discoveryResult.transferable_skills),
        workValues: JSON.stringify(discoveryResult.work_values),
        assessmentSummary: discoveryResult.assessment_summary || null,
        conversationId,
      };

      if (discoveryResult.stage_complete) {
        const top = topClusterIds(discoveryResult.cluster_scores);
        await prisma.careerDiscovery.upsert({
          where: { studentId },
          create: {
            studentId,
            ...upsertData,
            status: "complete",
            topClusters: top,
            completedAt: new Date(),
          },
          update: {
            ...upsertData,
            status: "complete",
            topClusters: top,
            completedAt: new Date(),
          },
        });

        // Update conversation stage to onboarding
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { stage: "onboarding" },
        });

        // Award discovery XP
        await awardEvent({
          studentId,
          eventType: "discovery_complete",
          sourceType: "conversation",
          sourceId: conversationId,
          xp: 25,
          mutate: () => {},
        }).catch((err) => logger.error("Failed to award discovery XP", { error: String(err) }));
      } else {
        await prisma.careerDiscovery.upsert({
          where: { studentId },
          create: { studentId, ...upsertData },
          update: upsertData,
        });
      }
    } catch (err) {
      logger.error("Discovery extraction failed", { error: String(err) });
    }

    // Still generate title, then return early (skip goal extraction for discovery)
    try {
      await generateConversationTitle(conversationId, fullResponse, conversationTitle);
    } catch (err) {
      logger.error("Failed to generate conversation title", { error: String(err) });
    }
    return;
  }

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
      const [updatedGoals, discovery] = await Promise.all([
        prisma.goal.findMany({
          where: { studentId, status: { in: [...GOAL_PLANNING_STATUSES] } },
          select: { level: true },
        }),
        prisma.careerDiscovery.findUnique({
          where: { studentId },
          select: { status: true },
        }),
      ]);
      const newStage = determineStage(updatedGoals, discovery?.status === "complete");
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
      const reviewMsgCount = await prisma.message.count({ where: { conversationId } });
      if (reviewMsgCount >= 4) {
        const hasMonthly = existingLevels.has("monthly");
        const hasWeekly = existingLevels.has("weekly");
        if (hasMonthly || hasWeekly) {
          await awardEvent({
            studentId,
            eventType: hasMonthly && hasWeekly ? "weekly_review" : "monthly_review",
            sourceType: "conversation",
            sourceId: conversationId,
            xp: hasMonthly && hasWeekly ? 60 : 40,
            mutate: (state) => {
              if (hasMonthly && hasWeekly) recordWeeklyReview(state);
              else if (hasMonthly) recordMonthlyReview(state);
            },
          });
        }
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
