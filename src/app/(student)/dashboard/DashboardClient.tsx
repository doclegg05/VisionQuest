"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Fire,
  Star,
  Target,
  ArrowRight,
  CalendarDots,
  ChatCircle,
  BookOpen,
  Briefcase,
  ClipboardText,
  Certificate,
  UserCircle,
  MapTrifold,
} from "@phosphor-icons/react";
import { AnimatedSection } from "@/components/ui/AnimatedSection";
import StreakCalendar from "@/components/ui/StreakCalendar";
import { MoodSparkline } from "@/components/progression/MoodSparkline";
import { CoachingArcBar } from "@/components/progression/CoachingArcBar";
import { type ReadinessBreakdown } from "@/lib/progression/readiness-score";

interface MoodEntry {
  id: string;
  score: number;
  context: string | null;
  extractedAt: string;
}

interface DashboardClientProps {
  studentName: string;
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
  careerDiscoveryComplete?: boolean;
  coachingArc?: { weekNumber: number; totalWeeks: number } | null;
  pathway?: {
    clusterId: string;
    clusterName: string;
    completedCount: number;
    totalCount: number;
    currentStepName: string | null;
  } | null;
}

export default function DashboardClient({
  studentName,
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
  readinessBreakdown: _readinessBreakdown,
  activityDays,
  careerDiscoveryComplete,
  coachingArc,
  pathway,
}: DashboardClientProps) {
  const [moodEntries, setMoodEntries] = useState<MoodEntry[]>([]);

  useEffect(() => {
    fetch("/api/mood")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { entries: MoodEntry[] } | null) => {
        if (data?.entries) {
          setMoodEntries(data.entries);
        }
      })
      .catch(() => {
        // Non-critical — fail silently
      });
  }, []);

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const recentAchievements = achievements.slice(-3).reverse();

  // Determine "next step" dynamically based on student state
  const nextStep = !orientationComplete
    ? {
        label: "Complete orientation checklist",
        detail: `${orientationProgress.completed} of ${orientationProgress.total} items done`,
        href: "/orientation",
        icon: ClipboardText,
      }
    : !hasGoals
      ? {
          label: "Set your first goal",
          detail: "Talk to Sage or add one manually",
          href: "/goals",
          icon: Target,
        }
      : certificationsStarted === 0
        ? {
            label: "Start a certification",
            detail: "Browse available certifications",
            href: "/learning",
            icon: Certificate,
          }
        : !resumeCreated
          ? {
              label: "Build your resume",
              detail: "Create your professional portfolio",
              href: "/portfolio",
              icon: Briefcase,
            }
          : {
              label: "Check in with Sage",
              detail: "Get coaching on your next move",
              href: "/chat",
              icon: ChatCircle,
            };

  // Suggested actions (context-aware pills)
  const actions: { label: string; href: string; icon: typeof Target }[] = [];
  if (!orientationComplete) actions.push({ label: "Orientation", href: "/orientation", icon: ClipboardText });
  if (!hasGoals) actions.push({ label: "Set Goals", href: "/goals", icon: Target });
  if (certificationsStarted === 0) actions.push({ label: "Certifications", href: "/learning", icon: Certificate });
  if (platformsVisited === 0) actions.push({ label: "Learning", href: "/learning", icon: BookOpen });
  if (!resumeCreated) actions.push({ label: "Resume", href: "/portfolio", icon: Briefcase });
  if (goalSuggestions.length > 0) actions.push({ label: "Career", href: "/career", icon: Target });

  const NextStepIcon = nextStep.icon;

  return (
    <div className="space-y-4">
      {/* 1. Hero Banner */}
      <AnimatedSection>
        <div className="page-hero">
          <div className="flex-1">
            <p className="page-eyebrow">
              Level {level} Explorer
            </p>
            <h1 className="page-title">
              Welcome back, {studentName}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-white/82">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <Fire size={16} weight="fill" className="animate-float text-orange-400" />
                {currentStreak} day streak
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/14 bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <Star size={16} weight="fill" className="text-[var(--accent-gold)]" />
                {achievements.length} achievements
              </span>
            </div>
            <div className="mt-5">
              <Link href="/chat" prefetch={false} className="primary-button px-5 py-3 text-sm">
                <ChatCircle size={18} weight="fill" />
                Open Sage
              </Link>
            </div>
          </div>
          {/* Readiness ring */}
          <div className="flex flex-col items-center gap-1">
            <div className="relative h-[72px] w-[72px]">
              <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2.5" />
                <circle
                  cx="18" cy="18" r="14" fill="none" stroke="#37b550" strokeWidth="2.5"
                  strokeDasharray={`${readinessScore} 100`} strokeLinecap="round"
                  className="transition-all"
                  style={{ animationName: "progress-fill", animationDuration: "var(--duration-slow)", animationTimingFunction: "var(--ease-spring)", animationFillMode: "both" }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center text-base font-bold text-white">
                {readinessScore}%
              </div>
            </div>
            <span className="text-[10px] uppercase tracking-[0.15em] text-white/50">Ready</span>
          </div>
          {/* XP bar inside hero */}
          <div className="w-full">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>{xpProgress.current} / {xpProgress.nextTarget} XP</span>
              <span>Level {level + 1}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-green)]"
                style={{ width: `${xpProgress.ratio * 100}%`, animationName: "progress-fill", animationDuration: "var(--duration-slow)", animationTimingFunction: "var(--ease-spring)", animationFillMode: "both" }}
              />
            </div>
          </div>
        </div>
      </AnimatedSection>

      {/* Coaching Arc Progress Bar */}
      {coachingArc && (
        <AnimatedSection delay={0.08}>
          <CoachingArcBar
            currentWeek={coachingArc.weekNumber}
            totalWeeks={coachingArc.totalWeeks}
          />
        </AnimatedSection>
      )}

      {/* Career DNA card */}
      {careerDiscoveryComplete && (
        <AnimatedSection delay={0.08}>
          <div className="surface-section p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent-green)]">
                  Career DNA
                </p>
                <p className="mt-1 font-semibold text-[var(--ink-strong)]">
                  Your Career DNA is ready
                </p>
                <p className="mt-0.5 text-sm text-[var(--ink-muted)]">
                  See your Holland code, transferable skills, work values, and top career clusters.
                </p>
              </div>
              <Link
                href="/profile"
                prefetch={false}
                className="primary-button shrink-0 px-5 py-3 text-sm"
              >
                <UserCircle size={18} weight="bold" />
                View Profile
              </Link>
            </div>
          </div>
        </AnimatedSection>
      )}

      {/* Pathway / Roadmap card */}
      {pathway && (
        <AnimatedSection delay={0.08}>
          <div className="surface-section p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent-green)]">
                  <MapTrifold size={14} weight="bold" className="mr-1 inline-block" />
                  Your Roadmap
                </p>
                <p className="mt-1 font-semibold text-[var(--ink-strong)]">
                  {pathway.clusterName}
                </p>
                <p className="mt-0.5 text-sm text-[var(--ink-muted)]">
                  {pathway.completedCount}/{pathway.totalCount} steps complete
                  {pathway.currentStepName && (
                    <> &middot; Next: <span className="font-medium text-[var(--ink-strong)]">{pathway.currentStepName}</span></>
                  )}
                </p>
              </div>
              <Link
                href="/learning"
                prefetch={false}
                className="shrink-0 text-sm font-semibold text-[var(--accent-green)]"
              >
                View full roadmap
              </Link>
            </div>
          </div>
        </AnimatedSection>
      )}

      {/* 2. Next Step Card */}
      <AnimatedSection delay={0.12}>
        <Link href={nextStep.href} prefetch={false} className="surface-section flex items-center gap-4 p-5 transition-transform hover:-translate-y-0.5 hover:shadow-lg">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent-green)] to-[#2a8a3c] text-white shadow-[0_4px_16px_var(--glow-green)]">
            <NextStepIcon size={22} weight="bold" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Your Next Step</p>
            <p className="mt-0.5 font-display text-lg font-bold text-[var(--ink-strong)]">{nextStep.label}</p>
            <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{nextStep.detail}</p>
          </div>
          <ArrowRight size={20} weight="bold" className="shrink-0 text-[var(--accent-green)]" />
        </Link>
      </AnimatedSection>

      {/* 3. Suggested Actions — horizontal scroll pills */}
      {actions.length > 0 && (
        <AnimatedSection delay={0.24}>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {actions.map((action) => {
              const ActionIcon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  prefetch={false}
                  className="surface-section inline-flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-medium text-[var(--ink-strong)] transition-transform hover:-translate-y-0.5"
                >
                  <ActionIcon size={16} weight="bold" className="text-[var(--accent-blue)]" />
                  {action.label}
                  <ArrowRight size={14} weight="bold" className="text-[var(--ink-faint)]" />
                </Link>
              );
            })}
          </div>
        </AnimatedSection>
      )}

      {/* 4. Progress Section — calendar + achievements */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <AnimatedSection delay={0.36}>
          <div className="surface-section p-5">
            <h3 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">Activity</h3>
            <StreakCalendar days={activityDays} />
            <div className="mt-3 flex items-center gap-3 text-sm text-[var(--ink-muted)]">
              <Fire size={16} weight="fill" className="text-orange-400" />
              <span>{currentStreak} day streak</span>
              <span className="text-[var(--ink-faint)]">&middot;</span>
              <span>Best: {longestStreak}</span>
            </div>
          </div>
        </AnimatedSection>

        <AnimatedSection delay={0.48}>
          <div className="surface-section p-5">
            <h3 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">Achievements</h3>
            {recentAchievements.length > 0 ? (
              <div className="space-y-2">
                {recentAchievements.map((a) => (
                  <div key={a.key} className="flex items-center gap-2.5 text-sm">
                    <Star size={16} weight="fill" className="shrink-0 text-[var(--accent-gold)]" />
                    <span className="font-medium text-[var(--ink-strong)]">{a.label}</span>
                    <span className="text-xs text-[var(--ink-muted)]">{a.desc}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--ink-muted)]">Complete actions to earn achievements.</p>
            )}
            {achievements.length > 3 && (
              <p className="mt-3 text-xs font-semibold text-[var(--accent-green)]">
                {achievements.length} total achievements
              </p>
            )}
            {/* Last level up */}
            {lastLevelUp && (
              <div className="mt-3 rounded-xl bg-[rgba(15,154,146,0.08)] px-3 py-2 text-xs text-[var(--ink-strong)]">
                Reached Level {lastLevelUp.level} — {lastLevelUp.reason}
              </div>
            )}
          </div>
        </AnimatedSection>
      </div>

      {/* 5. Motivation Trend */}
      {moodEntries.length > 0 && (
        <AnimatedSection delay={0.54}>
          <div className="surface-section p-5">
            <h3 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">Motivation Trend</h3>
            <MoodSparkline entries={moodEntries} />
          </div>
        </AnimatedSection>
      )}

      {/* 6. Advising Card */}
      <AnimatedSection delay={0.6}>
        <div className="surface-section p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-[var(--ink-muted)]">Advising</h3>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Appointments and follow-ups.
              </p>
            </div>
            <Link href="/appointments" prefetch={false} className="text-sm font-semibold text-[var(--accent-green)]">
              Open
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              {nextAppointment ? (
                <div className="rounded-[1.2rem] border border-[rgba(15,154,146,0.15)] bg-[rgba(15,154,146,0.08)] p-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
                    <CalendarDots size={14} weight="bold" />
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
                <div className="rounded-[1.2rem] border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                  No appointment scheduled. Your advising appointments will show up here.
                </div>
              )}
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-[var(--ink-strong)]">Follow-ups</p>
                {alertCount > 0 && (
                  <span className="rounded-full bg-[rgba(249,115,22,0.12)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-red)]">
                    {alertCount} alert{alertCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {tasks.length === 0 ? (
                <p className="text-sm text-[var(--ink-muted)]">No open follow-up tasks right now.</p>
              ) : (
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <div key={task.id} className="rounded-[1rem] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-[var(--ink-strong)]">{task.title}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          task.priority === "high"
                            ? "bg-[rgba(224,85,85,0.12)] text-[var(--accent-red)]"
                            : task.priority === "low"
                              ? "bg-[var(--surface-overlay)] text-[var(--ink-muted)]"
                              : "bg-[rgba(211,178,87,0.12)] text-[var(--accent-gold)]"
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
      </AnimatedSection>

      {/* 7. Goal Suggestions */}
      {goalSuggestions.length > 0 && (
        <AnimatedSection delay={0.72}>
          <div className="surface-section p-5">
            <h3 className="mb-3 text-sm font-medium text-[var(--ink-muted)]">Recommended for Your Goals</h3>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {goalSuggestions.map((suggestion) => (
                <Link
                  key={suggestion}
                  href="/learning"
                  prefetch={false}
                  className="shrink-0 rounded-[1rem] border border-[var(--accent-gold)]/20 bg-[var(--surface-raised)] px-4 py-3 text-sm font-medium text-[var(--ink-strong)] transition-transform hover:-translate-y-0.5"
                >
                  <BookOpen size={16} weight="bold" className="mb-1 text-[var(--accent-gold)]" />
                  <span className="block">{suggestion}</span>
                </Link>
              ))}
            </div>
          </div>
        </AnimatedSection>
      )}
    </div>
  );
}
