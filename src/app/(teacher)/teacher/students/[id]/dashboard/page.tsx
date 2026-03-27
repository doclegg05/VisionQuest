import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isStaffRole } from "@/lib/api-error";
import { assertStaffCanManageStudent } from "@/lib/classroom";
import { prisma } from "@/lib/db";
import {
  createInitialState,
  getAchievementsWithDefs,
  getXpProgress,
  parseState,
} from "@/lib/progression/engine";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import { matchGoalsToPlatforms } from "@/lib/spokes/goal-matcher";
import { computeReadinessScore } from "@/lib/progression/readiness-score";
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
  const [goalCount, progression, nextAppointment, tasks, alertCount, resumeData] = await Promise.all([
    prisma.goal.count({ where: { studentId, status: { in: [...GOAL_PLANNING_STATUSES] } } }),
    prisma.progression.findUnique({ where: { studentId } }),
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
    prisma.resumeData.findUnique({ where: { studentId }, select: { id: true } }),
  ]);

  const since28d = new Date();
  since28d.setDate(since28d.getDate() - 27);
  since28d.setHours(0, 0, 0, 0);

  const [orientationDoneCount, orientationTotalCount, activityEvents, bhagGoal] = await Promise.all([
    prisma.orientationProgress.count({ where: { studentId, completed: true } }),
    prisma.orientationItem.count(),
    prisma.progressionEvent.findMany({
      where: { studentId, occurredAt: { gte: since28d } },
      select: { occurredAt: true },
    }),
    prisma.goal.findFirst({
      where: { studentId, level: "bhag", status: "completed" },
      select: { id: true },
    }),
  ]);

  const activityDays: Record<string, number> = {};
  for (const event of activityEvents) {
    const day = event.occurredAt.toISOString().slice(0, 10);
    activityDays[day] = (activityDays[day] || 0) + 1;
  }

  const state = progression ? parseState(progression.state) : createInitialState();
  if (!state.resumeCreated && resumeData) {
    state.resumeCreated = true;
  }
  const readiness = computeReadinessScore({
    ...state,
    bhagCompleted: !!bhagGoal,
    orientationProgress: { completed: orientationDoneCount, total: orientationTotalCount },
  });
  const xpProgress = getXpProgress(state);
  const achievements = getAchievementsWithDefs(state);

  const lastLevelUp = state.levelUpHistory?.length > 0
    ? { ...state.levelUpHistory[state.levelUpHistory.length - 1] }
    : null;

  const planningGoals = await prisma.goal.findMany({
    where: { studentId, status: { in: [...GOAL_PLANNING_STATUSES] } },
    select: { content: true },
  });
  const goalMatchResult = matchGoalsToPlatforms(planningGoals.map((g) => g.content));


  return (
    <div className="page-shell">
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

      <div className="mb-6">
        <div className="page-hero rounded-[2rem] p-5 sm:p-7 md:p-10">
          <p className="page-eyebrow text-white/60">Student workspace</p>
          <h1 className="mt-2 font-display text-3xl text-white">
            Welcome back, {managedStudent.displayName}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">
            {goalCount > 0
              ? `${goalCount} goal${goalCount === 1 ? "" : "s"} in plan. Level ${state.level}, ${state.currentStreak} day streak, ${achievements.length} achievements.`
              : "No goals set yet."}
          </p>
        </div>
      </div>

      <DashboardClient
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
        xp={state.xp}
        hasGoals={goalCount > 0}
        orientationComplete={state.orientationComplete || false}
        certificationsStarted={state.certificationsStarted || 0}
        platformsVisited={state.platformsVisited?.length || 0}
        resumeCreated={state.resumeCreated || false}
        orientationProgress={{ completed: orientationDoneCount, total: orientationTotalCount }}
        goalSuggestions={goalMatchResult.suggestions}
        readinessScore={readiness.score}
        readinessBreakdown={readiness.breakdown}
        activityDays={activityDays}
      />
    </div>
  );
}
