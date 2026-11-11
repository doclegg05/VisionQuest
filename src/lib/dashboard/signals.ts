/**
 * The student dashboard's slow-moving reads: the facts readiness, the next
 * step and the overview are built from, minus the live ones in ./live.ts.
 *
 * Each group runs inside one `withAppReadTransaction`: RLS is set once and the
 * reads share one connection, so a group of n reads costs 4 + n round trips
 * where n separate app-client calls cost 4n (see src/lib/db.ts). The reads run
 * one after another, as readTasks does: a transaction is one connection, so
 * nothing is lost by not overlapping them.
 *
 * The arguments come from the modules that own each read
 * (fetch-readiness-data.ts, student-next-step.ts, readers.ts), so these ask
 * exactly what the per-student functions other surfaces call ask.
 */
import type { Certification, CertRequirement, Prisma } from "@prisma/client";
import { withAppReadTransaction } from "@/lib/db";
import { readinessQueries } from "@/lib/progression/fetch-readiness-data";
import { nextStepQueries } from "@/lib/progression/student-next-step";
import { overviewQueries } from "./readers";
import { orientationItemsQuery } from "./support";
import { invalidate } from "@/lib/cache";
import { cachedWhen, studentCacheKey, type CacheSession } from "./student-cache";
import { perRequest } from "./per-request";

type Tx = Prisma.TransactionClient;

/** What the student layout reads on every student page; the dashboard reuses it. */
export interface StudentShell {
  readonly goalPlanningCount: number;
  readonly progressionState: string | null;
  readonly orientationCompletedCount: number;
}

/** The facts that change only when the student, staff or a job writes them. */
export interface SlowSignals {
  readonly bhagCompleted: boolean;
  readonly certificationsEarned: number;
  readonly portfolioItemCount: number;
  readonly hasResume: boolean;
  readonly portfolioShared: boolean;
  readonly careerDiscoveryComplete: boolean;
  readonly monthlyGoalCount: number;
  readonly sageProposedUnconfirmedGoalCount: number;
  readonly discoveryAssistantTurnCount: number;
  readonly completedMilestoneCount: number;
  readonly certs: readonly (Certification & { requirements: CertRequirement[] })[];
  readonly applicability: string | null;
  readonly educationPlanStatus: string | null;
  readonly linkedGoals: number;
  readonly orientationItems: readonly { id: string; label: string }[];
}

/** Ten minutes. Every input is cleared on write; see ./student-cache.ts. */
export const SHELL_TTL_SECONDS = 600;

async function readShell(tx: Tx, studentId: string): Promise<StudentShell> {
  const readiness = readinessQueries(studentId);
  const goalPlanningCount = await tx.goal.count(nextStepQueries(studentId).goalCount);
  const progression = await tx.progression.findUnique(readiness.progression);
  const orientationCompletedCount = await tx.orientationProgress.count(readiness.orientationCompletedCount);
  return { goalPlanningCount, progressionState: progression?.state ?? null, orientationCompletedCount };
}

const shellKey = (session: CacheSession) => studentCacheKey(session, "shell");
const readShellNow = (studentId: string) => withAppReadTransaction((tx) => readShell(tx, studentId));
/**
 * Kept only once a Progression row exists: a student without one (new, or a
 * read that lost its RLS context and saw no rows) is read again every time.
 */
const keepShell = (shell: StudentShell) => shell.progressionState !== null;

/** The layout's three facts for a poll: kept ones when there are any, else read and kept. */
export function getStudentShell(session: CacheSession): Promise<StudentShell> {
  return cachedWhen(shellKey(session), SHELL_TTL_SECONDS, () => readShellNow(session.id), keepShell);
}

const pageShellFor = perRequest((studentId: string, role: string) => {
  const session = { id: studentId, role };
  return readFreshAndKeep(shellKey(session), SHELL_TTL_SECONDS, () => readShellNow(studentId), keepShell);
});

/**
 * The three facts for a page render (the student layout and the dashboard
 * page): read fresh, so a kept value a pre-commit read left behind
 * (src/lib/chat-context-write-through.ts, "Known, accepted races") cannot pin
 * the nav or readiness, then kept for the polls. One read per request: the
 * layout and the page share it through `perRequest`.
 */
export function readPageShell(session: CacheSession): Promise<StudentShell> {
  return pageShellFor(session.id, session.role);
}

async function readReadinessSignals(tx: Tx, studentId: string) {
  const q = readinessQueries(studentId);
  const bhagGoal = await tx.goal.findFirst(q.bhagGoal);
  const certificationsEarned = await tx.certification.count(q.certificationsEarned);
  const portfolioItemCount = await tx.portfolioItem.count(q.portfolioItemCount);
  const resume = await tx.resumeData.findUnique(q.resume);
  const publicPage = await tx.publicCredentialPage.findUnique(q.publicPage);
  return {
    bhagCompleted: Boolean(bhagGoal), certificationsEarned, portfolioItemCount,
    hasResume: Boolean(resume), portfolioShared: Boolean(publicPage?.isPublic),
  };
}

async function readNextStepSignals(tx: Tx, studentId: string) {
  const q = nextStepQueries(studentId);
  const careerDiscovery = await tx.careerDiscovery.findUnique(q.careerDiscovery);
  const monthlyGoalCount = await tx.goal.count(q.monthlyGoalCount);
  const sageProposedUnconfirmedGoalCount = await tx.goal.count(q.sageProposedUnconfirmedGoalCount);
  const discoveryAssistantTurnCount = await tx.message.count(q.discoveryAssistantTurnCount);
  const completedMilestoneCount = await tx.goal.count(q.completedMilestoneCount);
  const orientationItems = await tx.orientationItem.findMany(orientationItemsQuery(studentId));
  return {
    careerDiscoveryComplete: careerDiscovery?.status === "complete",
    monthlyGoalCount, sageProposedUnconfirmedGoalCount, discoveryAssistantTurnCount, completedMilestoneCount,
    orientationItems,
  };
}

async function readOverviewSignals(tx: Tx, studentId: string) {
  const q = overviewQueries(studentId);
  const certs = await tx.certification.findMany(q.certs);
  const enrollment = await tx.studentClassEnrollment.findFirst(q.enrollment);
  const educationPlan = await tx.formSubmission.findFirst(q.educationPlan);
  const linkedGoals = await tx.goal.count(q.linkedGoals);
  return {
    certs, linkedGoals,
    applicability: enrollment?.class.requirements[0]?.status ?? null,
    educationPlanStatus: educationPlan?.status ?? null,
  };
}

/** Every slow signal, read in one transaction. Uncached. */
export function readSlowSignals(studentId: string): Promise<SlowSignals> {
  return withAppReadTransaction(async (tx) => ({
    ...(await readReadinessSignals(tx, studentId)),
    ...(await readNextStepSignals(tx, studentId)),
    ...(await readOverviewSignals(tx, studentId)),
  }));
}

/**
 * How long a poll may serve slow signals the page or an earlier poll kept.
 * Longer than the poll interval on purpose: a TTL shorter than the poll never
 * serves a poll. What bounds staleness is invalidation, not the TTL: every
 * input but three is cleared on write (./student-cache.ts), and the page render
 * always reads fresh. The three that no write clears (discovery chat turns,
 * the class's Ready-to-Work requirement, a pathway's active flag) can lag by
 * up to this long, on a poll only.
 */
export const SLOW_SIGNALS_TTL_SECONDS = 600;

/**
 * True when the read saw at least one of the student's own rows. A read that
 * lost its RLS context sees none, and keeping that would pin a blank student
 * for the whole TTL. The orientation item list is left out: with no context
 * its "no progress yet" filter matches every item. A student with no rows at
 * all is simply read on every poll.
 */
export function sawStudentRows(slow: SlowSignals): boolean {
  return slow.bhagCompleted || slow.hasResume || slow.portfolioShared || slow.careerDiscoveryComplete
    || slow.certificationsEarned + slow.portfolioItemCount + slow.monthlyGoalCount + slow.sageProposedUnconfirmedGoalCount
      + slow.discoveryAssistantTurnCount + slow.completedMilestoneCount + slow.linkedGoals + slow.certs.length > 0
    || slow.applicability !== null || slow.educationPlanStatus !== null;
}

const slowKey = (session: CacheSession) => studentCacheKey(session, "slow");

/** The slow signals for a poll: kept ones when there are any, else read and kept. */
export function getSlowSignals(session: CacheSession): Promise<SlowSignals> {
  return cachedWhen(slowKey(session), SLOW_SIGNALS_TTL_SECONDS, () => readSlowSignals(session.id), sawStudentRows);
}

/**
 * The page render reads slow signals fresh (so unwatched inputs are never
 * stale on a page load) and keeps what it read for the polls that follow.
 */
export function readAndKeepSlowSignals(session: CacheSession): Promise<SlowSignals> {
  return readFreshAndKeep(slowKey(session), SLOW_SIGNALS_TTL_SECONDS, () => readSlowSignals(session.id), sawStudentRows);
}

/**
 * Drops the kept value, then reads through `cachedWhen`, so the read is the
 * key's in-flight read: a write that invalidates the key while the read runs
 * also drops the in-flight entry, and `cached()` then never stores the result.
 */
function readFreshAndKeep<T>(key: string, ttlSeconds: number, read: () => Promise<T>, keep: (value: T) => boolean): Promise<T> {
  invalidate(key);
  return cachedWhen(key, ttlSeconds, read, keep);
}
