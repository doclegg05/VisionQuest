import { prisma } from "@/lib/db";
import { resolveAiProvider } from "@/lib/ai";
import { getProviderClass, logAiAuditEvent, policyDecisionForProvider } from "@/lib/ai/audit";
import { GOAL_PLANNING_STATUSES, isGoalLevel } from "@/lib/goals";
import { extractGoals } from "@/lib/sage/goal-extractor";
import { proposeGoal } from "@/lib/sage/propose-goal";
import { extractMoodFromConversation } from "@/lib/sage/mood-extractor";
import { extractDiscoverySignals, topClusterIds } from "@/lib/sage/discovery-extractor";
import { determineStage } from "@/lib/sage/system-prompts";
import { detectAndRecordClassroomConfirmation } from "@/lib/sage/classroom-confirmation";
import { extractAndStoreMemories } from "@/lib/sage/memory/extract";
import { detectCrisisSignal, recordWellbeingConcern } from "@/lib/sage/crisis-detection";
import { retryWithBackoff } from "@/lib/sage/retry";
import {
  recordWeeklyReview,
  recordMonthlyReview,
} from "@/lib/progression/engine";
import { awardEvent } from "@/lib/progression/events";
import { logger } from "@/lib/logger";
import { generateConversationTitle } from "./conversation";
import type { ProgramType } from "@/lib/program-type";

// ─── Main post-response handler ─────────────────────────────────────────────

interface PostResponseParams {
  conversationId: string;
  conversationTitle: string | null;
  conversationStage: string;
  fullResponse: string;
  /** Persisted assistant Message.id that produced any extracted proposals. */
  sourceMessageId?: string;
  studentId: string;
  allMessages: { role: "user" | "model"; content: string }[];
  /** Most recent user turn — needed by the classroom-confirmation detector. */
  userMessage: string;
  /** Student's active program; null only for legacy callers. */
  programType: ProgramType | null;
  /** Null means classroom confirmation has not happened yet. */
  classroomConfirmedAt: Date | null;
}

/**
 * Handles all side effects after the AI response stream completes.
 * Runs asynchronously (fire-and-forget from the route).
 *
 * Steps:
 * 1. Extract goals from conversation
 * 2. Create proposed goal records for student confirmation
 * 3. Keep progression locked until the human confirms a proposal
 * 4. Update conversation stage if stage_complete
 * 5. Award review XP for review conversations
 * 6. Generate conversation title
 */
export async function handlePostResponse({
  conversationId,
  conversationTitle,
  conversationStage,
  fullResponse,
  sourceMessageId,
  studentId,
  allMessages,
  userMessage,
  programType,
  classroomConfirmedAt,
}: PostResponseParams): Promise<void> {
  // 0. Wellbeing/crisis safety-net — runs FIRST and independently of the AI
  //    provider, so a provider outage can never suppress a staff alert. The
  //    detector is a deterministic keyword scan (no AI cost/latency) on the
  //    student's latest turn, regardless of conversation stage.
  try {
    const signal = detectCrisisSignal(userMessage);
    if (signal.matched) {
      await recordWellbeingConcern({ studentId, conversationId, reason: "message_signal" });
    }
  } catch (err) {
    logger.error("Wellbeing detection failed", {
      conversationId,
      alert: "wellbeing_detection_failed",
      error: String(err),
    });
  }

  const provider = await resolveAiProvider({
    studentId,
    task: "sage_post_response",
    sensitivity: "student_record",
  });
  const providerClass = getProviderClass(provider.name);
  const postResponsePolicyDecision = policyDecisionForProvider(provider.name);
  const postResponseAllowCloud = providerClass === "cloud";
  const proposalSourceMessageId = sourceMessageId ?? conversationId;
  if (!sourceMessageId) {
    logger.warn("Post-response handler missing sourceMessageId; falling back to conversationId for proposal traceability.", {
      conversationId,
    });
  }

  await logAiAuditEvent({
    actorId: studentId,
    actorRole: "student",
    route: "background:chat/post-response",
    task: "sage_post_response",
    sensitivity: "student_record",
    policyDecision: postResponsePolicyDecision,
    status: "routed",
    targetId: conversationId,
    providerName: provider.name,
    providerClass,
    allowCloud: postResponseAllowCloud,
    inputChars: userMessage.length + fullResponse.length,
    reason:
      postResponsePolicyDecision === "local_only"
        ? "Post-response extraction uses student conversation content and is local-only by policy."
        : "Operator configured cloud AI; post-response extraction routed to the configured provider.",
  });

  // Fire-and-forget classroom-confirmation extractor. Only runs until the
  // student has confirmed their classroom; after that the onboarding prompt
  // stops asking and this extractor has nothing to look for.
  if (!classroomConfirmedAt) {
    void detectAndRecordClassroomConfirmation(
      provider,
      studentId,
      userMessage,
      fullResponse,
    ).catch((err) =>
      logger.error("Classroom confirmation extractor failed", {
        studentId,
        error: String(err),
      }),
    );
  }

  // Fire-and-forget memory extraction (Phase 2, Mem0 pattern). Uses the same
  // resolved provider as every other post-response extractor, so FERPA
  // routing is inherited. extractAndStoreMemories never throws, but the
  // catch stays as a belt-and-suspenders guard — memory must never block or
  // fail the post-response pipeline.
  if (process.env.SAGE_MEMORY_ENABLED?.trim().toLowerCase() !== "false") {
    void extractAndStoreMemories({
      provider,
      studentId,
      conversationId,
      messages: [
        ...allMessages,
        { role: "model" as const, content: fullResponse },
      ],
    }).catch((err) =>
      logger.error("Memory extraction failed", {
        studentId,
        error: String(err),
      }),
    );
  }
  // 0. Discovery extraction (runs instead of goal extraction during discovery)
  if (conversationStage === "discovery") {
    try {
      const discoveryResult = await retryWithBackoff(
        () =>
          extractDiscoverySignals(provider, [
            ...allMessages,
            { role: "model" as const, content: fullResponse },
          ]),
        {
          label: "Discovery extraction",
          alertKey: "discovery_extraction_exhausted",
          context: { conversationId, studentId },
        },
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

    // Rolling summary compaction is now handled by maybeUpdateSummary in the route
    await logAiAuditEvent({
      actorId: studentId,
      actorRole: "student",
      route: "background:chat/post-response",
      task: "sage_post_response",
      sensitivity: "student_record",
      policyDecision: postResponsePolicyDecision,
      status: "completed",
      targetId: conversationId,
      providerName: provider.name,
      providerClass,
      allowCloud: postResponseAllowCloud,
      inputChars: userMessage.length + fullResponse.length,
    });
    return;
  }

  // 1. Extract goals (program-aware framing via PROGRAM_HEADERS)
  const extracted = await extractGoals(
    provider,
    [...allMessages, { role: "model" as const, content: fullResponse }],
    conversationStage,
    programType,
  );

  // 2. Create proposed goal records. Sage can suggest, but a human must
  // confirm before a goal joins the student's plan/progression.
  const existingGoals = await prisma.goal.findMany({
    where: { studentId, status: { in: ["proposed", ...GOAL_PLANNING_STATUSES] } },
    select: { level: true },
  });
  const existingLevels = new Set(existingGoals.map((g) => g.level));

  for (const goal of extracted.goals_found) {
    const content = goal.content.trim();
    if (!isGoalLevel(goal.level) || !content) {
      continue;
    }

    if (!existingLevels.has(goal.level)) {
      try {
        const result = await proposeGoal({
          studentId,
          level: goal.level,
          content,
          sourceMessageId: proposalSourceMessageId,
          conversationId,
          invokedBy: studentId,
        });
        if (result.status === "created" || result.status === "duplicate") {
          existingLevels.add(goal.level);
        } else {
          logger.warn("Goal proposal rejected", { level: goal.level, reason: result.reason });
        }
      } catch (err) {
        logger.error("Failed to propose goal", { level: goal.level, error: String(err) });
      }
    }
  }

  // 3. No XP/progression here. Confirmation routes award goal-setting XP
  // after the student or staff accepts the proposal.

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

  // 6. Extract mood scores (fire-and-forget, checkin/review stages only)
  if (conversationStage === "checkin" || conversationStage === "review") {
    const moodMessages = [...allMessages, { role: "model" as const, content: fullResponse }];
    extractMoodFromConversation(conversationId, studentId, moodMessages, provider).catch((err) =>
      logger.error("Mood extraction failed", { conversationId, error: String(err) })
    );
  }

  // 7. Generate conversation title
  try {
    await generateConversationTitle(conversationId, fullResponse, conversationTitle);
  } catch (err) {
    logger.error("Failed to generate conversation title", { error: String(err) });
  }

  // Summary compaction is now handled by maybeUpdateSummary in the route
  await logAiAuditEvent({
    actorId: studentId,
    actorRole: "student",
    route: "background:chat/post-response",
    task: "sage_post_response",
    sensitivity: "student_record",
    policyDecision: postResponsePolicyDecision,
    status: "completed",
    targetId: conversationId,
    providerName: provider.name,
    providerClass,
    allowCloud: postResponseAllowCloud,
    inputChars: userMessage.length + fullResponse.length,
  });
}
