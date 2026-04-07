"use client";

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
} from "@phosphor-icons/react";
import { AnimatedSection } from "@/components/ui/AnimatedSection";

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
  hasGoals: boolean;
  orientationComplete: boolean;
  certificationsStarted: number;
  platformsVisited: number;
  resumeCreated: boolean;
  orientationProgress: { completed: number; total: number };
  incompleteOrientationItems: { id: string; label: string }[];
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
  hasGoals,
  orientationComplete,
  certificationsStarted,
  platformsVisited,
  resumeCreated,
  orientationProgress,
  incompleteOrientationItems,
}: DashboardClientProps) {
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

  // Suggested actions (context-aware pills) — merged into "What's Next" section
  const actions: { label: string; href: string; icon: typeof Target }[] = [];
  if (!orientationComplete) actions.push({ label: "Orientation", href: "/orientation", icon: ClipboardText });
  if (!hasGoals) actions.push({ label: "Set Goals", href: "/goals", icon: Target });
  if (certificationsStarted === 0) actions.push({ label: "Certifications", href: "/learning", icon: Certificate });
  if (platformsVisited === 0) actions.push({ label: "Learning", href: "/learning", icon: BookOpen });
  if (!resumeCreated) actions.push({ label: "Resume", href: "/portfolio", icon: Briefcase });

  const NextStepIcon = nextStep.icon;

  return (
    <div className="space-y-4">
      {/* Hero Banner (simplified — no XP bar) */}
      <AnimatedSection>
        <div className="page-hero">
          <div className="flex-1">
            <p className="page-eyebrow">
              Level {level} Explorer
            </p>
            <h1 className="page-title">
              Welcome back, {studentName}
            </h1>
            <div className="mt-4">
              <Link href="/chat" prefetch={false} className="primary-button px-5 py-3 text-sm">
                <ChatCircle size={18} weight="fill" />
                Open Sage
              </Link>
            </div>
          </div>
        </div>
      </AnimatedSection>

      {/* ── Section 1: Mountain Progress ── rendered in page.tsx above this component */}

      {/* ── Section 2: What's Next ── */}
      <AnimatedSection delay={0.12}>
        <div className="surface-section p-5">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            What&apos;s Next
          </h2>

          {/* Primary next step */}
          <Link href={nextStep.href} prefetch={false} className="flex items-center gap-4 rounded-[1.2rem] border border-[rgba(15,154,146,0.15)] bg-[rgba(15,154,146,0.08)] p-4 transition-transform hover:-translate-y-0.5 hover:shadow-lg">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent-green)] to-[#2a8a3c] text-white shadow-[0_4px_16px_var(--glow-green)]">
              <NextStepIcon size={22} weight="bold" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-bold text-[var(--ink-strong)]">{nextStep.label}</p>
              <p className="mt-0.5 text-sm text-[var(--ink-muted)]">{nextStep.detail}</p>
            </div>
            <ArrowRight size={20} weight="bold" className="shrink-0 text-[var(--accent-green)]" />
          </Link>

          {/* Incomplete orientation items */}
          {!orientationComplete && incompleteOrientationItems.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                Orientation steps remaining
              </p>
              {incompleteOrientationItems.map((item) => (
                <Link
                  key={item.id}
                  href="/orientation"
                  className="flex items-center gap-2 rounded-lg border border-[var(--toast-celebration-border)] bg-[var(--badge-warning-bg)] px-3 py-2 text-sm transition-colors hover:bg-[var(--badge-warning-bg)]"
                >
                  <span className="text-[var(--badge-warning-text)]">○</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          )}

          {/* Quick action pills */}
          {actions.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {actions.map((action) => {
                const ActionIcon = action.icon;
                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    prefetch={false}
                    className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-2 text-sm font-medium text-[var(--ink-strong)] transition-transform hover:-translate-y-0.5"
                  >
                    <ActionIcon size={16} weight="bold" className="text-[var(--accent-blue)]" />
                    {action.label}
                    <ArrowRight size={14} weight="bold" className="text-[var(--ink-faint)]" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </AnimatedSection>

      {/* ── Section 3: Your Progress ── */}
      <AnimatedSection delay={0.24}>
        <div className="surface-section p-5">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
            Your Progress
          </h2>

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-4">
            {/* XP Level */}
            <div className="flex items-center gap-2">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-green)] text-white">
                <span className="text-sm font-bold">{level}</span>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Level</p>
                <div className="mt-0.5 h-1.5 w-24 rounded-full bg-[var(--surface-overlay)]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-green)]"
                    style={{ width: `${xpProgress.ratio * 100}%` }}
                  />
                </div>
                <p className="mt-0.5 text-xs text-[var(--ink-faint)]">{xpProgress.current} / {xpProgress.nextTarget} XP</p>
              </div>
            </div>

            {/* Divider */}
            <div className="hidden h-10 w-px bg-[var(--border)] sm:block" />

            {/* Streak */}
            <div className="flex items-center gap-2">
              <Fire size={24} weight="fill" className="text-orange-400" />
              <div>
                <p className="text-lg font-bold text-[var(--ink-strong)]">{currentStreak}</p>
                <p className="text-xs text-[var(--ink-muted)]">day streak {longestStreak > currentStreak && <span className="text-[var(--ink-faint)]">&middot; best {longestStreak}</span>}</p>
              </div>
            </div>

            {/* Divider */}
            <div className="hidden h-10 w-px bg-[var(--border)] sm:block" />

            {/* Achievement count */}
            <div className="flex items-center gap-2">
              <Star size={24} weight="fill" className="text-[var(--accent-gold)]" />
              <div>
                <p className="text-lg font-bold text-[var(--ink-strong)]">{achievements.length}</p>
                <p className="text-xs text-[var(--ink-muted)]">achievements</p>
              </div>
            </div>
          </div>

          {/* Recent achievements */}
          {recentAchievements.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">
              {recentAchievements.map((a) => (
                <div key={a.key} className="flex items-center gap-2.5 text-sm">
                  <Star size={16} weight="fill" className="shrink-0 text-[var(--accent-gold)]" />
                  <span className="font-medium text-[var(--ink-strong)]">{a.label}</span>
                  <span className="text-xs text-[var(--ink-muted)]">{a.desc}</span>
                </div>
              ))}
            </div>
          )}

          {/* Last level up */}
          {lastLevelUp && (
            <div className="mt-3 rounded-xl bg-[rgba(15,154,146,0.08)] px-3 py-2 text-xs text-[var(--ink-strong)]">
              Reached Level {lastLevelUp.level} — {lastLevelUp.reason}
            </div>
          )}
        </div>
      </AnimatedSection>

      {/* ── Section 4: Advising ── */}
      <AnimatedSection delay={0.36}>
        <div className="surface-section p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Advising</h2>
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
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
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
    </div>
  );
}
