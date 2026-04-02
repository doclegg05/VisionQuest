import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createInitialState,
  getAchievementsWithDefs,
  getXpProgress,
  parseState,
} from "@/lib/progression/engine";
import { GOAL_PLANNING_STATUSES } from "@/lib/goals";
import { computeReadinessScore } from "@/lib/progression/readiness-score";
import { MountainProgressLazy } from "@/components/ui/MountainProgressLazy";
import DashboardClient from "./DashboardClient";


export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;

  const now = new Date();
  const [goalCount, progression, nextAppointment, tasks, alertCount, resumeData] = await Promise.all([
    prisma.goal.count({ where: { studentId: session.id, status: { in: [...GOAL_PLANNING_STATUSES] } } }),
    prisma.progression.findUnique({ where: { studentId: session.id } }),
    prisma.appointment.findFirst({
      where: {
        studentId: session.id,
        status: "scheduled",
        startsAt: { gte: now },
      },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        locationType: true,
        locationLabel: true,
      },
      orderBy: { startsAt: "asc" },
    }),
    prisma.studentTask.findMany({
      where: {
        studentId: session.id,
        status: { in: ["open", "in_progress"] },
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        priority: true,
        status: true,
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: 4,
    }),
    prisma.studentAlert.count({
      where: {
        studentId: session.id,
        status: "open",
      },
    }),
    prisma.resumeData.findUnique({
      where: { studentId: session.id },
      select: { id: true },
    }),
  ]);

  // Redirect brand-new students to the welcome flow
  if (goalCount === 0 && !progression) {
    const convCount = await prisma.conversation.count({ where: { studentId: session.id } });
    if (convCount === 0) {
      redirect("/welcome");
    }
  }

  // Fetch orientation progress for readiness score and incomplete required items
  const [orientationDoneCount, orientationTotalCount, bhagGoal, incompleteOrientationItems] = await Promise.all([
    prisma.orientationProgress.count({ where: { studentId: session.id, completed: true } }),
    prisma.orientationItem.count(),
    prisma.goal.findFirst({
      where: { studentId: session.id, level: "bhag", status: "completed" },
      select: { id: true },
    }),
    prisma.orientationItem.findMany({
      where: {
        required: true,
        OR: [
          {
            progress: {
              none: { studentId: session.id },
            },
          },
          {
            progress: {
              some: { studentId: session.id, completed: false },
            },
          },
        ],
      },
      select: { id: true, label: true },
      orderBy: { sortOrder: "asc" },
      take: 3,
    }),
  ]);

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

  return (
    <div className="page-shell">
      {/* Section 1: Mountain Progress (server-rendered) */}
      <div className="surface-section mb-4 overflow-hidden p-0">
        <MountainProgressLazy
          readinessScore={readiness.score}
          readinessBreakdown={readiness.breakdown}
          level={state.level}
        />
      </div>

      {/* Sections 2-4 rendered in DashboardClient */}
      <DashboardClient
        studentName={session.displayName}
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
        orientationProgress={{ completed: orientationDoneCount, total: orientationTotalCount }}
        incompleteOrientationItems={incompleteOrientationItems}
      />
    </div>
  );
}
