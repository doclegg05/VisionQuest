/**
 * The student's own dashboard, read once per request (F2).
 *
 * Before this module the layout, the page and four readers each fetched what
 * they needed, so one render read the planning-goal count three times,
 * progression, the orientation count, the resume, the application count and
 * the alert count twice, all as separate RLS-wrapped calls. Here each fact is
 * read once, grouped into transactions (./signals.ts, ./live.ts), and handed
 * to the pure builders the per-student readers also use, so the student sees
 * what `readOverview`, `getStudentNextStep` and the teacher's view compute.
 *
 * Student sessions only: the teacher's student-detail dashboard keeps calling
 * the per-student readers.
 */
import { readinessFromFacts, type StudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { prisma } from "@/lib/db";
import { nextStepFromFacts, nextStepQueries } from "@/lib/progression/student-next-step";
import { readDashboardGlobals, type DashboardGlobals } from "./globals";
import { readLiveSignals, readPageLiveSignals, type LiveSignals } from "./live";
import { overviewFromFacts, summarizeActivity, type DashboardActivity, type DashboardOverview } from "./readers";
import { getSlowSignals, getStudentShell, readAndKeepSlowSignals, type SlowSignals, type StudentShell } from "./signals";
import { ownStudentId, type CacheSession } from "./student-cache";
import { supportFromFacts, type DashboardSupport } from "./support";

export interface DashboardSignals {
  readonly shell: StudentShell;
  readonly slow: SlowSignals;
  readonly live: LiveSignals;
  readonly globals: DashboardGlobals;
}

export interface StudentDashboard {
  readonly readinessData: StudentReadinessData;
  readonly goalCount: number;
  readonly smsAwaitingConfirmation: boolean;
  readonly overview: DashboardOverview;
  readonly activity: DashboardActivity;
  readonly support: DashboardSupport;
}

export function readinessOf({ shell, slow, globals }: Omit<DashboardSignals, "live">): StudentReadinessData {
  return readinessFromFacts({
    progressionState: shell.progressionState,
    orientationCompletedCount: shell.orientationCompletedCount,
    orientationTotalCount: globals.orientationTotalCount,
    bhagCompleted: slow.bhagCompleted,
    certificationsEarned: slow.certificationsEarned,
    portfolioItemCount: slow.portfolioItemCount,
    hasResume: slow.hasResume,
    portfolioShared: slow.portfolioShared,
  });
}

/** The advising region, next step included. Pure. */
export function supportOf(signals: DashboardSignals, readinessData: StudentReadinessData, now = new Date()): DashboardSupport {
  const { shell, slow, live } = signals;
  const nextStep = nextStepFromFacts(readinessData, {
    careerDiscoveryComplete: slow.careerDiscoveryComplete,
    goalCount: shell.goalPlanningCount,
    monthlyGoalCount: slow.monthlyGoalCount,
    sageProposedUnconfirmedGoalCount: slow.sageProposedUnconfirmedGoalCount,
    discoveryAssistantTurnCount: slow.discoveryAssistantTurnCount,
    completedMilestoneCount: slow.completedMilestoneCount,
    savedJobCount: live.savedJobCount,
    applicationCount: live.applicationCount,
    openAlertCount: live.openAlertCount,
    jobsReadyAlertCount: live.jobsReadyAlertCount,
    openTaskCount: live.openTaskCount,
  });
  return supportFromFacts({ nextStep, alertCount: live.openAlertCount, appointment: live.appointment, orientationItems: slow.orientationItems }, now);
}

/** The outcome summaries. Pure. */
export function overviewOf({ slow, globals }: Omit<DashboardSignals, "shell" | "live">, applicationCount: number, now = new Date()): DashboardOverview {
  return overviewFromFacts({
    certs: slow.certs,
    templates: globals.readyToWorkTemplates,
    applicability: slow.applicability,
    applications: applicationCount,
    hasResume: slow.hasResume,
    educationPlanStatus: slow.educationPlanStatus,
    linkedGoals: slow.linkedGoals,
  }, now);
}

export async function loadStudentDashboard(session: CacheSession, now = new Date()): Promise<StudentDashboard> {
  const studentId = ownStudentId(session);
  const shell = await getStudentShell(session);
  const [slow, live, globals] = await Promise.all([
    readAndKeepSlowSignals(session),
    readPageLiveSignals(studentId),
    readDashboardGlobals(),
  ]);
  const signals = { shell, slow, live, globals };
  const readinessData = readinessOf(signals);
  const sms = live.smsPreference;
  return {
    readinessData,
    goalCount: shell.goalPlanningCount,
    // Enabled but unconfirmed: the channel is on and nothing is being delivered.
    // A revoked row is not this case; that student chose to stop.
    smsAwaitingConfirmation: sms?.enabled === true && sms.smsConsentAt === null && sms.smsRevokedAt === null,
    overview: overviewOf(signals, live.applicationCount, now),
    activity: summarizeActivity(live.activityTasks, now),
    support: supportOf(signals, readinessData, now),
  };
}

/** The advising region alone, for its poll (`GET /api/dashboard/support`). Live signals are read every time. */
export async function readStudentSupport(session: CacheSession, now = new Date()): Promise<DashboardSupport> {
  const studentId = ownStudentId(session);
  const [shell, slow, live, globals] = await Promise.all([
    getStudentShell(session),
    getSlowSignals(session),
    readLiveSignals(studentId),
    readDashboardGlobals(),
  ]);
  const signals = { shell, slow, live, globals };
  return supportOf(signals, readinessOf(signals), now);
}

/** The outcome summaries alone, for their poll (`GET /api/dashboard/overview`). The application count is live. */
export async function readStudentOverview(session: CacheSession, now = new Date()): Promise<DashboardOverview> {
  const studentId = ownStudentId(session);
  const [slow, globals, applicationCount] = await Promise.all([
    getSlowSignals(session),
    readDashboardGlobals(),
    prisma.application.count(nextStepQueries(studentId).applicationCount),
  ]);
  return overviewOf({ slow, globals }, applicationCount, now);
}
