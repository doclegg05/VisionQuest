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

const MODULES = [
  { href: "/chat", label: "Sage", icon: "💬", description: "Get guidance from your AI coach on goals, career plans, and next steps.", glow: "from-amber-300/40 via-orange-300/10 to-transparent" },
  { href: "/goals", label: "My Goals", icon: "🎯", description: "Track your path from big-picture vision down to today’s action items.", glow: "from-sky-300/40 via-cyan-300/10 to-transparent" },
  { href: "/orientation", label: "Orientation", icon: "📋", description: "Complete onboarding steps and download required forms.", glow: "from-emerald-300/40 via-green-200/10 to-transparent" },
  { href: "/learning", label: "Learning", icon: "📚", description: "Work through training platforms, certifications, and Ready to Work requirements in one place.", glow: "from-violet-300/40 via-fuchsia-200/10 to-transparent" },
  { href: "/career", label: "Career", icon: "🚀", description: "Track openings, events, applications, and career next steps from one place.", glow: "from-cyan-300/40 via-sky-200/10 to-transparent" },
  { href: "/appointments", label: "Advising", icon: "🗓️", description: "View advising appointments, follow-up tasks, and alerts.", glow: "from-teal-300/40 via-cyan-200/10 to-transparent" },
  { href: "/portfolio", label: "Portfolio", icon: "💼", description: "Build a collection of your skills, work samples, and achievements.", glow: "from-rose-300/40 via-orange-200/10 to-transparent" },
];

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

  const state = progression ? parseState(progression.state) : createInitialState();
  if (!state.resumeCreated && resumeData) {
    state.resumeCreated = true;
  }
  const readiness = computeReadinessScore(state);
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
        goalSuggestions={goalMatchResult.suggestions}
        readinessScore={readiness.score}
        readinessBreakdown={readiness.breakdown}
      />

      <div className="mb-4 mt-8 flex items-end justify-between gap-4">
        <div>
          <p className="page-eyebrow text-[var(--ink-muted)]">Modules</p>
          <h2 className="mt-2 font-display text-2xl text-[var(--ink-strong)]">Choose your next step</h2>
        </div>
        <p className="hidden max-w-sm text-sm leading-6 text-[var(--ink-muted)] md:block">
          Each area supports a different part of your progress, from planning to proof of readiness.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((mod) => (
          <Link
            key={mod.href}
            href={mod.href}
            prefetch={false}
            className="group relative overflow-hidden rounded-[1.5rem] border border-white/45 bg-[rgba(255,255,255,0.78)] p-5 shadow-[0_18px_50px_rgba(16,37,62,0.1)] backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-[0_26px_70px_rgba(16,37,62,0.14)]"
          >
            <div className={`absolute inset-x-0 top-0 h-20 bg-gradient-to-r ${mod.glow}`} />
            <div className="relative">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ink-strong)] text-2xl text-white shadow-[0_16px_32px_rgba(16,37,62,0.18)]">
                {mod.icon}
              </div>
              <h2 className="font-display text-xl text-[var(--ink-strong)]">{mod.label}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{mod.description}</p>
              <div className="mt-5 text-sm font-semibold text-[var(--accent-strong)] transition-transform group-hover:translate-x-1">
                Open module →
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
