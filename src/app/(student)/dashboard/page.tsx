import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getWelcomeCompletedAt } from "@/lib/progression/welcome-completion";
import { shouldEnterWelcome } from "@/lib/progression/welcome-routing";
import DashboardClient from "./DashboardClient";
import { MoodCheckIn } from "@/components/dashboard/MoodCheckIn";
import { loadStudentDashboard } from "@/lib/dashboard/student-dashboard";
import { readTasks } from "@/lib/dashboard/tasks";
import { taskQuerySchema } from "@/lib/dashboard/task-schemas";
import { SagePanels } from "@/components/dashboard/sage/SagePanels";
import { getLatestPanelSpec } from "@/lib/sage/panel-data";
import styles from "@/components/dashboard/dashboard.module.css";
import { SmsReconsentNotice } from "@/components/student/SmsReconsentNotice";

/** Dashboard-first home; exactly one next-action engine, `nextStepFromFacts`, reached through loadStudentDashboard.
 * /dashboard/classic still redirects here. Sage streaming stays in /chat.
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;
  // The task table and the Sage panel fail on their own, and so does each
  // region loadStudentDashboard returns (undefined: DashboardClient shows its
  // fallback). Its readiness read fails the page, as before F2: without it
  // the welcome routing below cannot be decided.
  const [dashboard, taskPage, sagePanel] = await Promise.allSettled([
    loadStudentDashboard(session), readTasks(session.id, taskQuerySchema.parse({})), getLatestPanelSpec(session.id),
  ]);
  if (dashboard.status === "rejected") throw dashboard.reason;
  const loaded = dashboard.value;
  // A Progression row is created by the app's check-in; it is not evidence
  // the student has completed welcome. Preserve the recorded-fact predicate.
  const orientationCompletedCount = loaded.readinessData.orientationProgress.completed;
  if (loaded.goalCount === 0 && orientationCompletedCount === 0) {
    const [conversationCount, welcomeCompletedAt] = await Promise.all([
      prisma.conversation.count({ where: { studentId: session.id } }),
      getWelcomeCompletedAt(session.id),
    ]);
    if (shouldEnterWelcome({ welcomeCompletedAt, goalCount: loaded.goalCount, conversationCount, orientationCompletedCount })) redirect("/welcome");
  }
  return <div className={`${styles.workspace} page-shell page-shell-wide min-w-0 space-y-6`}>
    <SmsReconsentNotice show={loaded.smsAwaitingConfirmation} />
    {/* The intro renders below the next-step card: at 375px the next step must fit in the first screen. */}
    <DashboardClient sessionId={session.id} moodContent={<MoodCheckIn />}
      intro={<>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div><h1 className="font-display text-2xl text-[var(--ink-strong)]">Your Dashboard</h1><p className="mt-1 text-[var(--ink-muted)]">Your next action, plans, and recorded progress in one place.</p></div>
          <Link href="/chat" className="secondary-button px-4 py-3">Talk to Sage</Link>
        </header>
      </>}
      initialOverview={loaded.overview}
      initialActivity={loaded.activity}
      initialTasks={taskPage.status === "fulfilled" ? taskPage.value : undefined}
      initialSupport={loaded.support}
    />
    {sagePanel.status === "fulfilled" && sagePanel.value && <SagePanels panel={sagePanel.value} showActions />}
    {sagePanel.status === "rejected" && <p className="text-sm text-[var(--ink-muted)]">Sage’s saved suggestions could not load. <Link className="inline-flex items-center min-h-11 underline" href="/chat">Open Sage</Link> or refresh this dashboard to try again.</p>}
  </div>;
}
