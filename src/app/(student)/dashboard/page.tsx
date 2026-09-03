import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { getWelcomeCompletedAt } from "@/lib/progression/welcome-completion";
import { shouldEnterWelcome } from "@/lib/progression/welcome-routing";
import { countStudentVisibleAlerts } from "@/lib/student-alerts";
import ChatWindow from "@/components/chat/ChatWindow";
import { AmbientPanels } from "@/components/dashboard/AmbientPanels";
import { SagePanels } from "@/components/dashboard/sage/SagePanels";
import { getLatestPanelSpec } from "@/lib/sage/panel-data";
import {
  getStudentNextStep,
  nextStepShortLabel,
} from "@/lib/progression/student-next-step";
import { PathToEmployment } from "@/components/progression/PathToEmployment";

/**
 * Chat-first student home (Phase 4 redesign, user-approved 2026-06-09).
 *
 * The Sage conversation IS the home surface; the ambient rail carries the
 * old dashboard's vital signs and deep-links into full pages. The classic
 * dashboard was retired 2026-07-20; /dashboard/classic now redirects here.
 *
 * The "Next up" hint on the readiness card derives from the SAME
 * StudentNextStepResult as the Current Target strip (nextStepShortLabel) —
 * the journey has exactly one next-action engine.
 */

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;

  const now = new Date();
  const [
    goalCount,
    nextAppointment,
    tasks,
    alertCount,
    readinessData,
    incompleteOrientationItems,
    sagePanel,
  ] = await Promise.all([
      prisma.goal.count({
        where: { studentId: session.id, status: { in: [...GOAL_PLANNING_STATUSES] } },
      }),
      prisma.appointment.findFirst({
        where: { studentId: session.id, status: "scheduled", startsAt: { gte: now } },
        select: { id: true, title: true, startsAt: true, locationLabel: true },
        orderBy: { startsAt: "asc" },
      }),
      prisma.studentTask.findMany({
        where: { studentId: session.id, status: { in: ["open", "in_progress"] } },
        select: { id: true, title: true, dueAt: true },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        take: 3,
      }),
      countStudentVisibleAlerts(session.id),
      fetchStudentReadinessData(session.id),
      prisma.orientationItem.findMany({
        where: {
          required: true,
          OR: [
            { progress: { none: { studentId: session.id } } },
            { progress: { some: { studentId: session.id, completed: false } } },
          ],
        },
        select: { id: true, label: true },
        orderBy: { sortOrder: "asc" },
        take: 3,
      }),
      getLatestPanelSpec(session.id),
    ]);

  const { state, readiness, orientationProgress } = readinessData;

  // Brand-new students still start at the welcome flow. "Brand new" is a
  // recorded fact (shouldEnterWelcome), never an inference from a row the app
  // creates on its own: this check used to read "no Progression row", which
  // the layout's ProgressionProvider falsifies on the student's very first
  // page mount. The cheap signals already in hand gate the extra reads.
  if (goalCount === 0 && orientationProgress.completed === 0) {
    const [conversationCount, welcomeCompletedAt] = await Promise.all([
      prisma.conversation.count({ where: { studentId: session.id } }),
      getWelcomeCompletedAt(session.id),
    ]);
    const shouldStartAtWelcome = shouldEnterWelcome({
      welcomeCompletedAt,
      goalCount,
      conversationCount,
      orientationCompletedCount: orientationProgress.completed,
    });
    if (shouldStartAtWelcome) {
      redirect("/welcome");
    }
  }

  // Reuse the readiness data fetched above — no duplicate readiness queries.
  const [nextStep, intakeSubmissionCount] = await Promise.all([
    getStudentNextStep(session.id, readinessData),
    prisma.formSubmission.count({
      where: {
        studentId: session.id,
        formId: { in: ["orientation-intake", "student-intake"] },
      },
    }),
  ]);

  const needsIntakeSignature = intakeSubmissionCount === 0;

  return (
    <div className="page-shell page-shell-wide space-y-6">
      {needsIntakeSignature && (
        <div className="relative overflow-hidden rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-orange-500/10 p-5 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm font-bold text-lg">
                ✍
              </div>
              <div>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300 border border-amber-500/30">
                  Action Required • Enrollment Clearance
                </span>
                <h3 className="text-base font-extrabold text-[var(--ink-strong)] mt-0.5">
                  Complete & Sign Your SPOKES Student Profile & Intake Form
                </h3>
                <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                  State TANF/SNAP workforce regulations require your digital signature on file to certify your class attendance and milestone credits.
                </p>
              </div>
            </div>
            <Link
              href="/intake"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition-all active:scale-95 whitespace-nowrap cursor-pointer"
            >
              Sign Intake Form →
            </Link>
          </div>
        </div>
      )}
      <PathToEmployment
        currentStepKey={nextStep.currentStepKey}
        title={nextStep.title}
        description={nextStep.description}
        whyItMatters={nextStep.whyItMatters}
        actionLabel={nextStep.actionLabel}
        actionLink={nextStep.actionLink}
        steps={nextStep.steps}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:order-2 lg:col-span-1">
          {sagePanel && <SagePanels panel={sagePanel} showActions />}
          <AmbientPanels
            readinessScore={readiness.score}
            nextGap={nextStepShortLabel(nextStep)}
            tasks={tasks.map((task) => ({
              ...task,
              dueAt: task.dueAt ? task.dueAt.toISOString() : null,
            }))}
            alertCount={alertCount}
            nextAppointment={
              nextAppointment
                ? {
                    title: nextAppointment.title,
                    startsAt: nextAppointment.startsAt.toISOString(),
                    locationLabel: nextAppointment.locationLabel,
                  }
                : null
            }
            incompleteOrientationItems={incompleteOrientationItems}
            orientationComplete={state.orientationComplete || false}
            resumeCreated={state.resumeCreated || false}
            level={state.level}
            currentStreak={state.currentStreak}
          />
        </div>
        <div className="surface-section overflow-hidden p-0 lg:order-1 lg:col-span-2">
          <ChatWindow />
        </div>
      </div>
    </div>
  );
}
