import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isStaffRole } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import {
  getAchievementsWithDefs,
  getXpProgress,
} from "@/lib/progression/engine";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import { fetchStudentReadinessData } from "@/lib/progression/fetch-readiness-data";
import { MountainProgressLazy } from "@/components/ui/MountainProgressLazy";
import DashboardClient from "@/app/(student)/dashboard/DashboardClient";

export default async function StudentDashboardPreview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session || !isStaffRole(session.role)) redirect("/");

  const { id: studentId } = await params;
  const managedStudent = await assertStaffCanManageStudent(session, studentId);

  const now = new Date();
  const [goalCount, nextAppointment, tasks, alertCount, readinessData, incompleteOrientationItems] = await Promise.all([
    prisma.goal.count({ where: { studentId, status: { in: [...GOAL_PLANNING_STATUSES] } } }),
    prisma.appointment.findFirst({
      where: { studentId, status: "scheduled", startsAt: { gte: now } },
      select: { id: true, title: true, startsAt: true, endsAt: true, locationType: true, locationLabel: true },
      orderBy: { startsAt: "asc" },
    }),
    prisma.studentTask.findMany({
      where: { studentId, status: { in: ["open", "in_progress"] } },
      select: { id: true, title: true, dueAt: true, priority: true, status: true },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 4,
    }),
    prisma.studentAlert.count({ where: { studentId, status: "open" } }),
    fetchStudentReadinessData(studentId),
    prisma.orientationItem.findMany({
      where: {
        required: true,
        OR: [
          {
            progress: {
              none: { studentId },
            },
          },
          {
            progress: {
              some: { studentId, completed: false },
            },
          },
        ],
      },
      select: { id: true, label: true },
      orderBy: { sortOrder: "asc" },
      take: 3,
    }),
  ]);

  const { state, readiness, orientationProgress } = readinessData;
  const xpProgress = getXpProgress(state);
  const achievements = getAchievementsWithDefs(state);

  const lastLevelUp = state.levelUpHistory?.length > 0
    ? { ...state.levelUpHistory[state.levelUpHistory.length - 1] }
    : null;

  return (
    <div className="page-shell">
      {/* Teacher-only preview banner */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-600">Dashboard Preview</p>
          <p className="mt-1 text-sm text-amber-800">
            Viewing <span className="font-semibold">{managedStudent.displayName}</span>&apos;s dashboard as the student sees it. Read-only.
          </p>
        </div>
        <Link
          href={`/teacher/students/${studentId}`}
          className="rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-50"
        >
          Back to Student Detail
        </Link>
      </div>

      {/* Section 1: Mountain Progress — matches student dashboard */}
      <div className="surface-section mb-4 overflow-hidden p-0">
        <MountainProgressLazy
          readinessScore={readiness.score}
          readinessBreakdown={readiness.breakdown}
          level={state.level}
        />
      </div>

      {/* Sections 2-4 rendered in DashboardClient */}
      <DashboardClient
        studentName={managedStudent.displayName}
        level={state.level}
        xpProgress={xpProgress}
        currentStreak={state.currentStreak}
        longestStreak={state.longestStreak}
        achievements={achievements}
        nextAppointment={nextAppointment
          ? {
              ...nextAppointment,
              startsAt: nextAppointment.startsAt.toISOString(),
              endsAt: nextAppointment.endsAt.toISOString(),
            }
          : null}
        tasks={tasks.map((task) => ({
          ...task,
          dueAt: task.dueAt ? task.dueAt.toISOString() : null,
        }))}
        alertCount={alertCount}
        lastLevelUp={lastLevelUp}
        hasGoals={goalCount > 0}
        orientationComplete={state.orientationComplete || false}
        certificationsStarted={state.certificationsStarted || 0}
        platformsVisited={state.platformsVisited?.length || 0}
        resumeCreated={state.resumeCreated || false}
        orientationProgress={orientationProgress}
        incompleteOrientationItems={incompleteOrientationItems}
      />
    </div>
  );
}
