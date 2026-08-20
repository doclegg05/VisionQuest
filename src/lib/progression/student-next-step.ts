import { prisma } from "@/lib/db";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import type { ProgressionState } from "./engine";
import {
  fetchStudentReadinessData,
  type StudentReadinessData,
} from "./fetch-readiness-data";

export type PathStepKey =
  | "orientation"
  | "discover"
  | "goal"
  | "learn"
  | "prove"
  | "prepare"
  | "apply"
  | "followUp";

export type PathStepStatus = "locked" | "available" | "active" | "complete" | "blocked";

export interface PathStep {
  key: PathStepKey;
  label: string;
  status: PathStepStatus;
  description: string;
}

export interface StudentNextStepResult {
  currentStepKey: PathStepKey;
  title: string;
  description: string;
  whyItMatters: string;
  actionLabel: string;
  actionLink: string;
  steps: PathStep[];
}

export interface StudentNextStepSignals {
  state: Pick<
    ProgressionState,
    "certificationsEarned" | "portfolioItemCount" | "resumeCreated" | "platformsVisited"
  >;
  /**
   * Orientation is journey step 0. Complete follows the readiness engine's
   * all-items convention (2026-07-31 decision): the persisted progression
   * flag, or every orientation item done — not required-only. Callers also
   * treat an unseeded checklist (zero items) as complete so an empty table
   * never blocks the journey.
   */
  orientationComplete: boolean;
  bhagCompleted: boolean;
  hasCompletedDiscovery: boolean;
  goalCount: number;
  monthlyGoalCount: number;
  completedMilestoneCount: number;
  savedJobCount: number;
  applicationCount: number;
  openAlertCount: number;
  openTaskCount: number;
  /**
   * Planning-status goals that are Sage proposals still awaiting instructor
   * confirmation (sourceMessageId set, never confirmed). When every planning
   * goal is one of these, the next-step surfaces "confirm with your coach"
   * instead of silently advancing. Phase gating (hasGoals) is unchanged.
   */
  sageProposedUnconfirmedGoalCount: number;
  /**
   * Assistant turns across the student's discovery-stage conversations.
   * Used only to surface a "ask your coach to review" nudge when discovery
   * never completes despite a long-running conversation.
   */
  discoveryAssistantTurnCount: number;
}

/**
 * Assistant turns in discovery-stage conversations after which an incomplete
 * discovery is treated as stalled and the student is nudged to ask their
 * coach for a manual review.
 */
export const DISCOVERY_STALL_ASSISTANT_TURNS = 10;

const DISCOVERY_STALL_NUDGE =
  "Been chatting for a while? Ask your coach to review your discovery and mark it complete.";

function buildStep(
  key: PathStepKey,
  label: string,
  status: PathStepStatus,
  description: string,
): PathStep {
  return { key, label, status, description };
}

export function resolveStudentNextStep(signals: StudentNextStepSignals): StudentNextStepResult {
  const hasGoals =
    signals.goalCount > 0 ||
    signals.monthlyGoalCount > 0 ||
    signals.bhagCompleted;
  const hasLearningProgress =
    signals.completedMilestoneCount > 0 ||
    signals.state.certificationsEarned > 0;
  const hasPortfolioItems = signals.state.portfolioItemCount > 0;
  const hasResume = signals.state.resumeCreated;
  const hasAppliedOrSaved =
    signals.savedJobCount > 0 ||
    signals.applicationCount > 0;
  const hasOpenTasksOrAlerts =
    signals.openAlertCount > 0 ||
    signals.openTaskCount > 0;

  // Every planning goal is an unconfirmed Sage proposal — the student has a
  // plan on paper, but no instructor has confirmed any of it yet. Keep the
  // phase unlocked (hasGoals stays true) but make confirmation the current
  // action instead of silently advancing past it.
  const goalsAwaitConfirmationOnly =
    !signals.bhagCompleted &&
    signals.goalCount > 0 &&
    signals.sageProposedUnconfirmedGoalCount >= signals.goalCount;
  const interceptForGoalConfirmation =
    signals.hasCompletedDiscovery && hasGoals && goalsAwaitConfirmationOnly && !hasLearningProgress;

  const orientationStatus: PathStepStatus = signals.orientationComplete ? "complete" : "active";
  const discoverStatus: PathStepStatus = signals.hasCompletedDiscovery
    ? "complete"
    : signals.orientationComplete
      ? "active"
      : "locked";
  const goalStatus: PathStepStatus = hasGoals
    ? interceptForGoalConfirmation
      ? "active"
      : "complete"
    : signals.hasCompletedDiscovery
      ? "active"
      : "locked";
  const learnStatus: PathStepStatus = hasLearningProgress
    ? "complete"
    : hasGoals
      ? interceptForGoalConfirmation
        ? "available"
        : "active"
      : "locked";
  const proveStatus: PathStepStatus = hasPortfolioItems
    ? "complete"
    : hasLearningProgress
      ? "active"
      : "locked";
  const prepareStatus: PathStepStatus = hasResume
    ? "complete"
    : hasPortfolioItems
      ? "active"
      : "locked";
  const applyStatus: PathStepStatus = hasAppliedOrSaved
    ? "complete"
    : hasResume
      ? "active"
      : "locked";
  const followUpStatus: PathStepStatus = hasOpenTasksOrAlerts
    ? "blocked"
    : hasAppliedOrSaved
      ? "complete"
      : "locked";

  let currentStepKey: PathStepKey = "discover";
  let title = "Talk to Sage about your career interests";
  let description = "Chat with Sage to explore your strengths, interests, and matching career paths.";
  let whyItMatters =
    "Knowing your target career field helps you focus your study on jobs that fit you.";
  let actionLabel = "Chat with Sage";
  let actionLink = "/chat";

  if (!signals.orientationComplete) {
    currentStepKey = "orientation";
    title = "Finish your orientation checklist";
    description = "Complete each item on your orientation checklist. It gets you set up for the program.";
    whyItMatters =
      "Orientation covers the basics you need before career work starts. Finish it to open the rest of your path.";
    actionLabel = "Go to Orientation";
    actionLink = "/orientation";
  } else if (!signals.hasCompletedDiscovery) {
    currentStepKey = "discover";
    if (signals.discoveryAssistantTurnCount >= DISCOVERY_STALL_ASSISTANT_TURNS) {
      // The discovery conversation has run long without completing —
      // usually the automatic extractor never fired. Keep chatting as the
      // primary action, but tell the student a coach can unblock them.
      description = `${description} ${DISCOVERY_STALL_NUDGE}`;
    }
  } else if (interceptForGoalConfirmation) {
    currentStepKey = "goal";
    title = "Confirm this goal with your coach";
    description =
      "Sage suggested your current goals. Ask your instructor to look them over and confirm they fit your plan.";
    whyItMatters =
      "A quick check-in makes your plan official and keeps you and your coach working toward the same target.";
    actionLabel = "Review My Goals";
    actionLink = "/goals";
  } else if (!hasGoals) {
    currentStepKey = "goal";
    title = "Set and confirm your goals";
    description = "Set your long-term career direction and choose a monthly focus.";
    whyItMatters =
      "A clear goal connects your weekly work to the kind of job you want.";
    actionLabel = "Set My Goals";
    actionLink = "/goals";
  } else if (!hasLearningProgress) {
    currentStepKey = "learn";
    title = "Complete your next learning milestone";
    description = "Work on the weekly goals, platform tasks, or certification steps tied to your plan.";
    whyItMatters =
      "Consistent practice builds the skills and credentials employers look for.";
    actionLabel = "View My Learning";
    actionLink = "/learning";
  } else if (!hasPortfolioItems) {
    currentStepKey = "prove";
    title = "Add proof of what you can do";
    description = "Add a certificate, project, work sample, or training milestone. It goes in your portfolio.";
    whyItMatters =
      "Employers value concrete proof of skills. Your portfolio turns progress into evidence.";
    actionLabel = "Add Proof";
    actionLink = "/portfolio";
  } else if (!hasResume) {
    currentStepKey = "prepare";
    title = "Create or upload your resume";
    description = "Use the Resume Builder to create a clear, job-ready resume.";
    whyItMatters =
      "A polished resume helps you move from training into real applications.";
    actionLabel = "Open Resume Builder";
    actionLink = "/portfolio";
  } else if (!hasAppliedOrSaved) {
    currentStepKey = "apply";
    title = "Save your first job opportunity";
    description = "Browse jobs, matches, and hiring events in the Career Hub.";
    whyItMatters =
      "Saving target jobs helps you plan ahead. You can tailor your resume, cover letter, and interview prep.";
    actionLabel = "Explore Career Hub";
    actionLink = "/career";
  } else {
    currentStepKey = "followUp";
    if (hasOpenTasksOrAlerts) {
      title = "Resolve advising items and follow-up tasks";
      description = "Check your appointments, open alerts, and tasks from your instructor.";
      whyItMatters =
        "Following up removes barriers before they slow down your job search.";
      actionLabel = "View Advising";
      actionLink = "/appointments";
    } else {
      title = "Keep your applications moving";
      description = "Keep checking saved jobs, updating application status, and preparing for interviews.";
      whyItMatters =
        "Staying current with applications and follow-up keeps your job search active.";
      actionLabel = "Go to Career Hub";
      actionLink = "/career";
    }
  }

  const steps: PathStep[] = [
    buildStep("orientation", "Orientation", orientationStatus, "Finish program basics"),
    buildStep("discover", "Discover", discoverStatus, "Explore career paths"),
    buildStep("goal", "Goal", goalStatus, "Set career focus"),
    buildStep("learn", "Learn", learnStatus, "Build skills"),
    buildStep("prove", "Prove", proveStatus, "Collect proof"),
    buildStep("prepare", "Prepare", prepareStatus, "Ready your resume"),
    buildStep("apply", "Apply", applyStatus, "Track opportunities"),
    buildStep("followUp", "Follow Up", followUpStatus, "Handle next steps"),
  ];

  return {
    currentStepKey,
    title,
    description,
    whyItMatters,
    actionLabel,
    actionLink,
    steps,
  };
}

/**
 * The short "next up" label for the current step. Derived from the same
 * StudentNextStepResult the Current Target card renders, so a surface that
 * shows a next hint (the dashboard readiness card) can never disagree with
 * the journey strip. This is the ONE next-action engine — do not add a
 * second heuristic (e.g. lowest readiness dimension) beside it.
 */
export function nextStepShortLabel(result: StudentNextStepResult): string | null {
  return result.steps.find((step) => step.key === result.currentStepKey)?.label ?? null;
}

export async function getStudentNextStep(
  studentId: string,
  /**
   * Readiness data the caller already fetched (or is fetching) for its own
   * render — passing it avoids a duplicate 8-query readiness fetch.
   */
  preloadedReadinessData?: StudentReadinessData | Promise<StudentReadinessData>,
): Promise<StudentNextStepResult> {
  const readinessData = await (preloadedReadinessData ?? fetchStudentReadinessData(studentId));
  const { state, bhagCompleted } = readinessData;

  // Journey step 0. buildReadinessSnapshot already resolved the all-items
  // convention into state.orientationComplete (persisted flag OR every
  // orientation item complete); an unseeded checklist never blocks.
  const orientationComplete =
    state.orientationComplete || readinessData.orientationProgress.total === 0;

  // Planning statuses that can still be awaiting instructor confirmation —
  // "confirmed" and "completed" goals are settled by definition.
  const unconfirmablePlanningStatuses = GOAL_PLANNING_STATUSES.filter(
    (status) => status !== "confirmed" && status !== "completed",
  );

  const [
    careerDiscovery,
    goalCount,
    monthlyGoalsCount,
    sageProposedUnconfirmedCount,
    discoveryAssistantTurns,
    completedMilestonesCount,
    savedJobsCount,
    applicationsCount,
    openAlertsCount,
    openTasksCount,
  ] = await Promise.all([
    prisma.careerDiscovery.findUnique({
      where: { studentId },
      select: { status: true },
    }),
    prisma.goal.count({
      where: { studentId, status: { in: [...GOAL_PLANNING_STATUSES] } },
    }),
    prisma.goal.count({
      where: {
        studentId,
        level: "monthly",
        status: { in: [...GOAL_PLANNING_STATUSES] },
      },
    }),
    prisma.goal.count({
      where: {
        studentId,
        status: { in: unconfirmablePlanningStatuses },
        sourceMessageId: { not: null },
        confirmedAt: null,
      },
    }),
    prisma.message.count({
      where: {
        studentId,
        role: "assistant",
        conversation: { stage: "discovery" },
      },
    }),
    prisma.goal.count({
      where: { studentId, level: { in: ["weekly", "task", "daily"] }, status: "completed" },
    }),
    prisma.studentSavedJob.count({
      where: { studentId },
    }),
    prisma.application.count({
      where: { studentId },
    }),
    prisma.studentAlert.count({
      where: { studentId, status: "open" },
    }),
    prisma.studentTask.count({
      where: { studentId, status: { in: ["open", "in_progress"] } },
    }),
  ]);

  return resolveStudentNextStep({
    state,
    orientationComplete,
    bhagCompleted,
    hasCompletedDiscovery: careerDiscovery?.status === "complete",
    goalCount,
    monthlyGoalCount: monthlyGoalsCount,
    sageProposedUnconfirmedGoalCount: sageProposedUnconfirmedCount,
    discoveryAssistantTurnCount: discoveryAssistantTurns,
    completedMilestoneCount: completedMilestonesCount,
    savedJobCount: savedJobsCount,
    applicationCount: applicationsCount,
    openAlertCount: openAlertsCount,
    openTaskCount: openTasksCount,
  });
}
