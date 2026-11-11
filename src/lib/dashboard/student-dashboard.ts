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
import type { CertTemplate } from "@prisma/client";
import { readinessFromFacts, type StudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { prisma } from "@/lib/db";
import { errorForLog } from "@/lib/log-error";
import { logger } from "@/lib/logger";
import { nextStepFromFacts, nextStepQueries } from "@/lib/progression/student-next-step";
import { orientationTotal, readDashboardGlobals, readyToWorkTemplates, type DashboardGlobals } from "./globals";
import { readAlertCounts, readLiveSignals, readPageCounts, type AlertCounts, type LiveSignals, type PageCounts } from "./live";
import { overviewFromFacts, summarizeActivity, type DashboardActivity, type DashboardOverview } from "./readers";
import { getSlowSignals, getStudentShell, readAndKeepSlowSignals, readPageShell, type SlowSignals, type StudentShell } from "./signals";
import { ownStudentId, type CacheSession } from "./student-cache";
import { supportFromFacts, type DashboardSupport } from "./support";

export interface DashboardSignals {
  readonly shell: StudentShell;
  readonly slow: SlowSignals;
  readonly live: LiveSignals;
  readonly globals: DashboardGlobals;
}

/**
 * Readiness and the goal count are always there: welcome routing needs them,
 * so their reads fail the page. Each region is undefined when one of its own
 * reads failed, and DashboardClient then shows that region's "could not load"
 * fallback and retries it; the other regions render.
 */
export interface StudentDashboard {
  readonly readinessData: StudentReadinessData;
  readonly goalCount: number;
  readonly smsAwaitingConfirmation: boolean;
  readonly overview: DashboardOverview | undefined;
  readonly activity: DashboardActivity | undefined;
  readonly support: DashboardSupport | undefined;
}

type ReadinessInputs = Pick<DashboardSignals, "shell" | "slow"> & { readonly globals: Pick<DashboardGlobals, "orientationTotalCount"> };

export function readinessOf({ shell, slow, globals }: ReadinessInputs): StudentReadinessData {
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
export function supportOf(signals: Pick<DashboardSignals, "shell" | "slow" | "live">, readinessData: StudentReadinessData, now = new Date()): DashboardSupport {
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
export function overviewOf({ slow, globals }: { readonly slow: SlowSignals; readonly globals: Pick<DashboardGlobals, "readyToWorkTemplates"> }, applicationCount: number, now = new Date()): DashboardOverview {
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

/** The page's reads: the fatal ones as values, each region-only one undefined if it failed. */
interface PageReads {
  readonly shell: StudentShell;
  readonly slow: SlowSignals;
  readonly orientationTotalCount: number;
  readonly templates: readonly CertTemplate[] | undefined;
  readonly page: PageCounts | undefined;
  readonly alerts: AlertCounts | undefined;
}

function fatal<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

function regionInput<T>(input: string, result: PromiseSettledResult<T>): T | undefined {
  if (result.status === "fulfilled") return result.value;
  logger.warn("Dashboard region read failed; the region shows its fallback", { input, error: errorForLog(result.reason) });
  return undefined;
}

/** Builds a region from inputs that loaded; a missing input or a failed build leaves it to its fallback. */
function region<I, T>(name: string, input: I | undefined, build: (input: I) => T): T | undefined {
  if (input === undefined) return undefined;
  try {
    return build(input);
  } catch (error) {
    logger.warn("Dashboard region failed to build; the region shows its fallback", { region: name, error: errorForLog(error) });
    return undefined;
  }
}

async function readPage(session: CacheSession): Promise<PageReads> {
  const studentId = ownStudentId(session);
  const [shell, slow, total, templates, page, alerts] = await Promise.allSettled([
    readPageShell(session), readAndKeepSlowSignals(session), orientationTotal(),
    readyToWorkTemplates(), readPageCounts(studentId), readAlertCounts(studentId),
  ]);
  return {
    shell: fatal(shell), slow: fatal(slow), orientationTotalCount: fatal(total),
    templates: regionInput("ready-to-work templates", templates),
    page: regionInput("live counts", page),
    alerts: regionInput("alert counts", alerts),
  };
}

// Enabled but unconfirmed: the channel is on and nothing is being delivered.
// A revoked row is not this case; that student chose to stop.
const awaitingConfirmation = (sms: PageCounts["smsPreference"]) =>
  sms?.enabled === true && sms.smsConsentAt === null && sms.smsRevokedAt === null;

export async function loadStudentDashboard(session: CacheSession, now = new Date()): Promise<StudentDashboard> {
  const { shell, slow, orientationTotalCount, templates, page, alerts } = await readPage(session);
  const readinessData = readinessOf({ shell, slow, globals: { orientationTotalCount } });
  const overviewInput = page && templates ? { applicationCount: page.applicationCount, templates } : undefined;
  return {
    readinessData,
    goalCount: shell.goalPlanningCount,
    smsAwaitingConfirmation: page ? awaitingConfirmation(page.smsPreference) : false,
    overview: region("overview", overviewInput, (input) =>
      overviewOf({ slow, globals: { readyToWorkTemplates: input.templates } }, input.applicationCount, now)),
    activity: region("activity", page, (counts) => summarizeActivity(counts.activityTasks, now)),
    support: region("support", page && alerts ? { ...page, ...alerts } : undefined, (live) =>
      supportOf({ shell, slow, live }, readinessData, now)),
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
