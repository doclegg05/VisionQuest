"use client";

import Link from "next/link";
import XpBar from "@/components/ui/XpBar";
import StreakBadge from "@/components/ui/StreakBadge";
import AchievementList from "@/components/ui/AchievementList";
import RecentActivity from "@/components/ui/RecentActivity";
import SuggestedActions from "@/components/ui/SuggestedActions";
import ReadinessScore from "@/components/ui/ReadinessScore";
import StreakCalendar from "@/components/ui/StreakCalendar";
import CohortCard from "@/components/ui/CohortCard";
import { type ReadinessBreakdown } from "@/lib/progression/readiness-score";

interface DashboardClientProps {
  level: number;
  xpProgress: {
    current: number;
    nextTarget: number;
    prevTarget: number;
    ratio: number;
  };
  currentStreak: number;
  longestStreak: number;
  achievements: { key: string; label: string; desc: string }[];
  nextAppointment: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    locationType: string;
    locationLabel: string | null;
  } | null;
  tasks: {
    id: string;
    title: string;
    dueAt: string | null;
    priority: string;
    status: string;
  }[];
  alertCount: number;
  lastLevelUp: { level: number; at: string; reason: string } | null;
  xp: number;
  hasGoals: boolean;
  orientationComplete: boolean;
  certificationsStarted: number;
  platformsVisited: number;
  resumeCreated: boolean;
  goalSuggestions: string[];
  readinessScore: number;
  readinessBreakdown: ReadinessBreakdown;
  activityDays: Record<string, number>;
  classProgress?: {
    className: string;
    classmateCount: number;
    avgOrientationPct: number;
    orientationCompletedThisWeek: number;
    avgReadinessScore: number;
  } | null;
}

export default function DashboardClient({
  level,
  xpProgress,
  currentStreak,
  longestStreak,
  achievements,
  nextAppointment,
  tasks,
  alertCount,
  lastLevelUp,
  xp,
  hasGoals,
  orientationComplete,
  certificationsStarted,
  platformsVisited,
  resumeCreated,
  goalSuggestions,
  readinessScore,
  readinessBreakdown,
  activityDays,
  classProgress,
}: DashboardClientProps) {
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* Job Readiness Score */}
      <div className="surface-section p-5 flex flex-col items-center md:col-span-2">
        <h3 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">Job Readiness Score</h3>
        <ReadinessScore score={readinessScore} breakdown={readinessBreakdown} />
      </div>

      {/* Cohort card (only if enrolled in a class) */}
      {classProgress && (
        <CohortCard
          className={classProgress.className}
          classmateCount={classProgress.classmateCount}
          avgOrientationPct={classProgress.avgOrientationPct}
          orientationCompletedThisWeek={classProgress.orientationCompletedThisWeek}
          avgReadinessScore={classProgress.avgReadinessScore}
        />
      )}

      {/* XP & Level */}
      <div className="surface-section p-5">
        <h3 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">Your Progress</h3>
        <XpBar
          current={xpProgress.current}
          nextTarget={xpProgress.nextTarget}
          prevTarget={xpProgress.prevTarget}
          ratio={xpProgress.ratio}
          level={level}
        />
        <div className="mt-4">
          <StreakBadge currentStreak={currentStreak} longestStreak={longestStreak} />
          <StreakCalendar days={activityDays} />
        </div>
      </div>

      {/* Achievements */}
      <div className="surface-section p-5">
        <h3 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">
          Achievements ({achievements.length})
        </h3>
        <AchievementList achievements={achievements} />
      </div>

      {/* Suggested Next Steps */}
      <div className="surface-section p-5">
        <h3 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">Suggested Next Steps</h3>
        <SuggestedActions
          hasGoals={hasGoals}
          orientationComplete={orientationComplete}
          certificationsStarted={certificationsStarted}
          platformsVisited={platformsVisited}
          resumeCreated={resumeCreated}
          currentStreak={currentStreak}
          goalSuggestions={goalSuggestions}
        />
      </div>

      {/* Recent Activity */}
      <div className="surface-section p-5">
        <h3 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">Recent Wins</h3>
        <RecentActivity
          achievements={achievements}
          lastLevelUp={lastLevelUp}
          currentStreak={currentStreak}
          xp={xp}
        />
      </div>

      <div className="surface-section p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-[var(--ink-muted)]">Advising</h3>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Keep up with appointments, follow-ups, and outreach.
            </p>
          </div>
          <Link href="/appointments" prefetch={false} className="text-sm font-semibold text-[var(--accent-strong)]">
            Open
          </Link>
        </div>

        {nextAppointment ? (
          <div className="rounded-[1.2rem] border border-[rgba(15,154,146,0.15)] bg-[rgba(15,154,146,0.08)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-secondary)]">
              Next Appointment
            </p>
            <p className="mt-2 font-display text-xl text-[var(--ink-strong)]">{nextAppointment.title}</p>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              {dateFormatter.format(new Date(nextAppointment.startsAt))}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {nextAppointment.locationLabel || nextAppointment.locationType.replace("_", " ")}
            </p>
          </div>
        ) : (
          <div className="rounded-[1.2rem] border border-dashed border-[rgba(18,38,63,0.14)] p-4 text-sm text-[var(--ink-muted)]">
            No appointment is scheduled yet. Your advising appointments will show up here.
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm font-semibold text-[var(--ink-strong)]">Open follow-ups</p>
          {alertCount > 0 ? (
            <span className="rounded-full bg-[rgba(249,115,22,0.12)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-strong)]">
              {alertCount} alert{alertCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        {tasks.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ink-muted)]">No open follow-up tasks right now.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="rounded-[1rem] border border-[rgba(18,38,63,0.1)] bg-white/70 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--ink-strong)]">{task.title}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    task.priority === "high"
                      ? "bg-rose-100 text-rose-700"
                      : task.priority === "low"
                        ? "bg-slate-100 text-slate-600"
                        : "bg-amber-100 text-amber-700"
                  }`}>
                    {task.priority}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  {task.dueAt ? `Due ${dateFormatter.format(new Date(task.dueAt))}` : "No due date"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
