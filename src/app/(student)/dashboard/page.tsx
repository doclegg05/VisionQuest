import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { getWelcomeCompletedAt } from "@/lib/progression/welcome-completion";
import { shouldEnterWelcome } from "@/lib/progression/welcome-routing";
import DashboardClient from "./DashboardClient";
import { MoodCheckIn } from "@/components/dashboard/MoodCheckIn";
import { readOverview, readActivity } from "@/lib/dashboard/readers";
import { readSupport } from "@/lib/dashboard/support";
import { readTasks } from "@/lib/dashboard/tasks";
import { taskQuerySchema } from "@/lib/dashboard/task-schemas";
import { SagePanels } from "@/components/dashboard/sage/SagePanels";
import { getLatestPanelSpec } from "@/lib/sage/panel-data";
import styles from "@/components/dashboard/dashboard.module.css";
import { SmsReconsentNotice } from "@/components/student/SmsReconsentNotice";

/** Dashboard-first home; exactly one next-action engine, in readSupport.
 * /dashboard/classic still redirects here. Sage streaming stays in /chat.
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;
  const [goalCount, readinessData, smsPreference] = await Promise.all([
    prisma.goal.count({ where: { studentId: session.id, status: { in: [...GOAL_PLANNING_STATUSES] } } }),
    fetchStudentReadinessData(session.id),
    // Read here, on the student's own page: DashboardClient is also mounted by
    // the teacher's student-detail dashboard, where "your" preferences would
    // mean the teacher's (upstream f801ed69, W4).
    prisma.notificationPreference.findUnique({
      where: { studentId_channel: { studentId: session.id, channel: "sms" } },
      select: { enabled: true, smsConsentAt: true, smsRevokedAt: true },
    }),
  ]);
  const { orientationProgress } = readinessData;
  // Enabled but unconfirmed: the channel is on and nothing is being delivered.
  // A revoked row is not this case; that student chose to stop.
  const smsAwaitingConfirmation =
    smsPreference?.enabled === true &&
    smsPreference.smsConsentAt === null &&
    smsPreference.smsRevokedAt === null;
  // A Progression row is created by the app's check-in; it is not evidence
  // the student has completed welcome. Preserve the recorded-fact predicate.
  if (goalCount === 0 && orientationProgress.completed === 0) {
    const [conversationCount, welcomeCompletedAt] = await Promise.all([
      prisma.conversation.count({ where: { studentId: session.id } }),
      getWelcomeCompletedAt(session.id),
    ]);
    if (shouldEnterWelcome({ welcomeCompletedAt, goalCount, conversationCount, orientationCompletedCount: orientationProgress.completed })) redirect("/welcome");
  }

  const intakeSubmissionCount = await prisma.formSubmission.count({
    where: { studentId: session.id, formId: { in: ["orientation-intake", "student-intake"] } },
  });
  // KNOWN GAP (owner: the intake bundle, not this page). Neither "orientation-intake"
  // nor "student-intake" is in the SPOKES catalog (src/lib/spokes/forms.ts), and
  // /api/forms/sign refuses any formId that is not, so the ONLY writer of these two
  // rows is the anonymous QR-code flow (src/lib/intake/pdf-stamped-packet.ts).
  // A teacher-enrolled student cannot clear this banner in-app. Keep the existing
  // predicate and copy pending the intake owner's decision; never redirect an
  // authenticated student into anonymous enrollment. /orientation owns signing.
  const needsIntakeSignature = intakeSubmissionCount === 0;

  // Independent failures never erase other regions. API retries share these readers.
  const [overview, activity, taskPage, support, sagePanel] = await Promise.allSettled([
    readOverview(session.id), readActivity(session.id), readTasks(session.id, taskQuerySchema.parse({})),
    readSupport(session.id, readinessData), getLatestPanelSpec(session.id),
  ]);
  return <div className={`${styles.workspace} page-shell page-shell-wide min-w-0 space-y-6`}>
    <SmsReconsentNotice show={smsAwaitingConfirmation} />
    {/* The intro renders below the next-step card: at 375px the next step must fit in the first screen. */}
    <DashboardClient sessionId={session.id} moodContent={<MoodCheckIn />}
      intro={<>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div><h1 className="font-display text-2xl font-semibold text-[var(--ink-strong)]">Your dashboard</h1><p className="mt-1 text-[var(--ink-muted)]">Your next action, plans, and recorded progress in one place.</p></div>
          <Link href="/chat" className="secondary-button px-4 py-3">Talk to Sage</Link>
        </header>
        {needsIntakeSignature && <section aria-label="Student profile signature" className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-5">
          <div><h2 className="font-semibold text-[var(--ink-strong)]">Sign your student profile form</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Your class hours only count once your signed form is on file.</p></div>
          <Link href="/orientation" className="primary-button px-5 py-3">Sign my form</Link>
        </section>}
      </>}
      initialOverview={overview.status === "fulfilled" ? overview.value : undefined}
      initialActivity={activity.status === "fulfilled" ? activity.value : undefined}
      initialTasks={taskPage.status === "fulfilled" ? taskPage.value : undefined}
      initialSupport={support.status === "fulfilled" ? support.value : undefined}
    />
    {sagePanel.status === "fulfilled" && sagePanel.value && <SagePanels panel={sagePanel.value} showActions />}
    {sagePanel.status === "rejected" && <p className="text-sm text-[var(--ink-muted)]">Sage’s saved suggestions could not load. <Link className="inline-flex items-center min-h-11 underline" href="/chat">Open Sage</Link> or refresh this dashboard to try again.</p>}
  </div>;
}
