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
import { matchGoalsToPlatforms } from "@/lib/spokes/goal-matcher";
import { computeReadinessScore } from "@/lib/progression/readiness-score";
import { getLearningPathway } from "@/lib/learning-pathway";
import { getOrCreateCoachingArc } from "@/lib/sage/coaching-arcs";
import { rankJobs } from "@/lib/job-board/recommendation";
import DashboardClient from "./DashboardClient";


export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;

  const now = new Date();
  const [goalCount, progression, nextAppointment, tasks, alertCount, resumeData, careerDiscovery, pathway, coachingArc] = await Promise.all([
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
    prisma.careerDiscovery.findUnique({
      where: { studentId: session.id },
      select: { status: true },
    }),
    getLearningPathway(session.id),
    getOrCreateCoachingArc(session.id).catch(() => null),
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

  // Fetch job board data for widget
  const jobBoardData = await (async () => {
    const enrollment = await prisma.studentClassEnrollment.findFirst({
      where: { studentId: session.id, status: "active" },
      select: { classId: true },
    });
    if (!enrollment) return { jobs: [], hasDiscovery: false };

    const jobConfig = await prisma.jobClassConfig.findUnique({
      where: { classId: enrollment.classId },
    });
    if (!jobConfig) return { jobs: [], hasDiscovery: false };

    const [jobListings, discovery] = await Promise.all([
      prisma.jobListing.findMany({
        where: { classConfigId: jobConfig.id, status: "active" },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, title: true, company: true, location: true, salary: true, clusters: true, url: true },
      }),
      prisma.careerDiscovery.findUnique({
        where: { studentId: session.id },
        select: { topClusters: true, hollandCode: true },
      }),
    ]);

    const recommendations = rankJobs(
      jobListings.map((j) => ({ id: j.id, location: j.location, clusters: j.clusters })),
      discovery,
      jobConfig.region,
    );

    return {
      jobs: jobListings.map((j) => {
        const rec = recommendations.find((r) => r.jobListingId === j.id);
        return { ...j, matchScore: rec?.score ?? 0, matchLabel: rec?.matchLabel ?? null, savedStatus: null };
      }).sort((a, b) => b.matchScore - a.matchScore),
      hasDiscovery: !!discovery,
    };
  })();

  return (
    <div className="page-shell">
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
        careerDiscoveryComplete={careerDiscovery?.status === "complete"}
        coachingArc={
          coachingArc && coachingArc.status === "active"
            ? { weekNumber: coachingArc.weekNumber, totalWeeks: coachingArc.template.durationWeeks }
            : null
        }
        jobBoardData={jobBoardData}
        pathway={pathway ? {
          clusterId: pathway.clusterId,
          clusterName: pathway.clusterName,
          completedCount: pathway.completedCount,
          totalCount: pathway.totalCount,
          currentStepName: pathway.steps.find((s) => s.isCurrent)?.name ?? null,
        } : null}
      />
    </div>
  );
}
