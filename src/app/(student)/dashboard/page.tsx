import Link from "next/link";
import { redirect } from "next/navigation";
import PageIntro from "@/components/ui/PageIntro";
import { getSession } from "@/lib/auth";
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

  // Fetch orientation progress and activity data for readiness + streak calendar
  const since28d = new Date();
  since28d.setDate(since28d.getDate() - 27);
  since28d.setHours(0, 0, 0, 0);

  const [orientationDoneCount, orientationTotalCount, activityEvents, bhagGoal] = await Promise.all([
    prisma.orientationProgress.count({ where: { studentId: session.id, completed: true } }),
    prisma.orientationItem.count(),
    prisma.progressionEvent.findMany({
      where: { studentId: session.id, occurredAt: { gte: since28d } },
      select: { occurredAt: true },
    }),
    prisma.goal.findFirst({
      where: { studentId: session.id, level: "bhag", status: "completed" },
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

  // Get goal suggestions from BHAG
  const planningGoals = await prisma.goal.findMany({
    where: { studentId: session.id, status: { in: [...GOAL_PLANNING_STATUSES] } },
    select: { content: true },
  });
  const goalTexts = planningGoals.map((goal) => goal.content);
  const goalMatchResult = matchGoalsToPlatforms(goalTexts);

  return (
    <div className="page-shell">
      <PageIntro
        eyebrow="Student workspace"
        title={`Welcome back, ${session.displayName}`}
        description={
          goalCount > 0
            ? `You have ${goalCount} goal${goalCount === 1 ? "" : "s"} in your plan. Keep building steady momentum.`
            : "Start with Sage or add your first goal in My Goals to turn your vision into a plan."
        }
        actions={(
          <Link href="/chat" prefetch={false} className="primary-button px-5 py-3 text-sm">
            Open Sage
          </Link>
        )}
      >
        <div className="mt-6 flex flex-wrap gap-3 text-sm text-white/82">
          <span className="rounded-full border border-white/14 bg-white/10 px-3 py-1.5 backdrop-blur-sm">
            Level {state.level}
          </span>
          <span className="rounded-full border border-white/14 bg-white/10 px-3 py-1.5 backdrop-blur-sm">
            {state.currentStreak} day streak
          </span>
          <span className="rounded-full border border-white/14 bg-white/10 px-3 py-1.5 backdrop-blur-sm">
            {achievements.length} achievements
          </span>
        </div>
      </PageIntro>

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
