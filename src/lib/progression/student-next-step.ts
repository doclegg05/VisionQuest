import { prisma } from "@/lib/db";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import type { ProgressionState } from "./engine";
import { fetchStudentReadinessData } from "./fetch-readiness-data";

export type PathStepKey =
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
  bhagCompleted: boolean;
  hasCompletedDiscovery: boolean;
  goalCount: number;
  monthlyGoalCount: number;
  completedMilestoneCount: number;
  savedJobCount: number;
  applicationCount: number;
  openAlertCount: number;
  openTaskCount: number;
}

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

  const discoverStatus: PathStepStatus = signals.hasCompletedDiscovery ? "complete" : "active";
  const goalStatus: PathStepStatus = hasGoals
    ? "complete"
    : signals.hasCompletedDiscovery
      ? "active"
      : "locked";
  const learnStatus: PathStepStatus = hasLearningProgress
    ? "complete"
    : hasGoals
      ? "active"
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
    "Identifying your target career field helps focus your study and preparation on positions that fit you.";
  let actionLabel = "Chat with Sage";
  let actionLink = "/chat";

  if (!signals.hasCompletedDiscovery) {
    currentStepKey = "discover";
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
    description = "Add a certificate, project, work sample, or training milestone to your portfolio.";
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
      "Saving target jobs helps you tailor your resume, cover letter, and interview practice.";
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

export async function getStudentNextStep(studentId: string): Promise<StudentNextStepResult> {
  const readinessData = await fetchStudentReadinessData(studentId);
  const { state, bhagCompleted } = readinessData;

  const [
    careerDiscovery,
    goalCount,
    monthlyGoalsCount,
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
    bhagCompleted,
    hasCompletedDiscovery: careerDiscovery?.status === "complete",
    goalCount,
    monthlyGoalCount: monthlyGoalsCount,
    completedMilestoneCount: completedMilestonesCount,
    savedJobCount: savedJobsCount,
    applicationCount: applicationsCount,
    openAlertCount: openAlertsCount,
    openTaskCount: openTasksCount,
  });
}
