"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import XpBar from "@/components/ui/XpBar";
import StreakBadge from "@/components/ui/StreakBadge";
import SuggestedActions from "@/components/ui/SuggestedActions";
import StreakCalendar from "@/components/ui/StreakCalendar";
import { type ReadinessBreakdown } from "@/lib/progression/readiness-score";

const MountainProgress = dynamic(
  () => import("@/components/ui/MountainProgress"),
  {
    ssr: false,
    loading: () => (
      <div className="h-[200px] animate-pulse rounded-[1.5rem] bg-gradient-to-b from-[#1a2a4a] to-[#4a7cb8] md:h-[320px]" />
    ),
  },
);

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
  orientationProgress: { completed: number; total: number };
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
  xp: _xp,
  hasGoals,
  orientationComplete,
  certificationsStarted,
  platformsVisited,
  resumeCreated,
  orientationProgress,
  goalSuggestions,
  readinessScore,
  readinessBreakdown,
  activityDays,
}: DashboardClientProps) {
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  // Last 3 achievements for the progress card
  const recentAchievements = achievements.slice(-3).reverse();

  return (
    <div className="space-y-4">
      {/* 1. Mountain Progress Hero */}
      <div className="surface-section overflow-hidden p-0">
        <MountainProgress
          readinessScore={readinessScore}
          readinessBreakdown={readinessBreakdown}
          level={level}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 2. What's Next — the single most important card */}
        <div className="surface-section p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-[var(--ink-muted)]">What&apos;s Next</h3>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">Your top priorities right now.</p>
            </div>
            <Link href="/chat" prefetch={false} className="primary-button px-4 py-2 text-xs">
              Ask Sage
            </Link>
          </div>
          <SuggestedActions
            hasGoals={hasGoals}
            orientationComplete={orientationComplete}
            orientationProgress={orientationProgress}
            certificationsStarted={certificationsStarted}
            platformsVisited={platformsVisited}
            resumeCreated={resumeCreated}
            currentStreak={currentStreak}
            goalSuggestions={goalSuggestions}
          />
        </div>

        {/* 3. Your Progress — compressed XP, streaks, recent achievements */}
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
          </div>

          {/* Recent achievements inline */}
          {recentAchievements.length > 0 && (
            <div className="mt-4 border-t border-[rgba(18,38,63,0.08)] pt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                Recent ({achievements.length} total)
              </p>
              <div className="space-y-1.5">
                {recentAchievements.map((a) => (
                  <div key={a.key} className="flex items-center gap-2 text-sm">
                    <span className="text-amber-500">&#9733;</span>
                    <span className="font-medium text-[var(--ink-strong)]">{a.label}</span>
                    <span className="text-xs text-[var(--ink-muted)]">{a.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Last level up */}
          {lastLevelUp && (
            <div className="mt-3 rounded-xl bg-[rgba(15,154,146,0.08)] px-3 py-2 text-xs text-[var(--ink-strong)]">
              Reached Level {lastLevelUp.level} — {lastLevelUp.reason}
            </div>
          )}

          {/* Activity calendar */}
          <div className="mt-4">
            <StreakCalendar days={activityDays} />
          </div>
        </div>

        {/* 4. Advising — appointment + tasks */}
        <div className="surface-section p-5 md:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-[var(--ink-muted)]">Advising</h3>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Appointments, follow-ups, and outreach.
              </p>
            </div>
            <Link href="/appointments" prefetch={false} className="text-sm font-semibold text-[var(--accent-strong)]">
              Open
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Appointment */}
            <div>
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
                  No appointment scheduled. Your advising appointments will show up here.
                </div>
              )}
            </div>

            {/* Tasks */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-[var(--ink-strong)]">Follow-ups</p>
                {alertCount > 0 && (
                  <span className="rounded-full bg-[rgba(249,115,22,0.12)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                    {alertCount} alert{alertCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {tasks.length === 0 ? (
                <p className="text-sm text-[var(--ink-muted)]">No open follow-up tasks right now.</p>
              ) : (
                <div className="space-y-2">
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
        </div>
      </div>
    </div>
  );
}
