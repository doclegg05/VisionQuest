"use client";

import Link from "next/link";

interface SuggestedActionsProps {
  hasGoals: boolean;
  orientationComplete: boolean;
  certificationsStarted: number;
  platformsVisited: number;
  resumeCreated: boolean;
  currentStreak: number;
  goalSuggestions: string[];
}

interface Action {
  emoji: string;
  title: string;
  desc: string;
  href: string;
  priority: number;
}

export default function SuggestedActions({
  hasGoals,
  orientationComplete,
  certificationsStarted,
  platformsVisited,
  resumeCreated,
  currentStreak,
  goalSuggestions,
}: SuggestedActionsProps) {
  const actions: Action[] = [];

  if (!hasGoals) {
    actions.push({
      emoji: "\u{1F4AC}",
      title: "Set your first goal",
      desc: "Talk to Sage to define your big dream and turn it into a plan.",
      href: "/chat",
      priority: 1,
    });
  }

  if (!orientationComplete) {
    actions.push({
      emoji: "\u{1F4CB}",
      title: "Complete orientation",
      desc: "Review program forms and finish your onboarding checklist.",
      href: "/orientation",
      priority: 2,
    });
  }

  if (certificationsStarted === 0) {
    actions.push({
      emoji: "\u{1F3C6}",
      title: "Explore certifications",
      desc: "See what industry certifications you can earn through SPOKES.",
      href: "/certifications",
      priority: 3,
    });
  }

  if (platformsVisited === 0) {
    actions.push({
      emoji: "\u{1F4DA}",
      title: "Visit a learning platform",
      desc: "Check out the training platforms available to you.",
      href: "/courses",
      priority: 4,
    });
  }

  if (!resumeCreated && hasGoals) {
    actions.push({
      emoji: "\u{1F4BC}",
      title: "Start your portfolio",
      desc: "Begin building your employment portfolio and resume.",
      href: "/portfolio",
      priority: 5,
    });
  }

  if (currentStreak === 0 && hasGoals) {
    actions.push({
      emoji: "\u{1F525}",
      title: "Start a streak",
      desc: "Check in daily to build momentum and earn bonus XP.",
      href: "/chat",
      priority: 6,
    });
  }

  // Add goal-based suggestions
  for (const suggestion of goalSuggestions.slice(0, 1)) {
    actions.push({
      emoji: "\u{1F3AF}",
      title: "Goal match found",
      desc: suggestion,
      href: "/courses",
      priority: 3.5,
    });
  }

  // Sort by priority, take top 3
  actions.sort((a, b) => a.priority - b.priority);
  const topActions = actions.slice(0, 3);

  if (topActions.length === 0) {
    return (
      <div className="rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 p-4 text-center">
        <p className="text-lg mb-1">{"\u2728"}</p>
        <p className="text-sm font-medium text-emerald-800">You&apos;re making great progress!</p>
        <p className="text-xs text-emerald-600 mt-0.5">Keep talking to Sage and working toward your goals.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {topActions.map((action) => (
        <Link
          key={action.href + action.title}
          href={action.href}
          prefetch={false}
          className="group flex items-start gap-3 rounded-xl border border-[var(--border)] bg-white/60 p-3 transition-all hover:-translate-y-0.5 hover:border-[rgba(15,154,146,0.25)] hover:shadow-sm"
        >
          <span className="text-xl">{action.emoji}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--ink-strong)] group-hover:text-[var(--accent-secondary)]">{action.title}</p>
            <p className="text-xs text-[var(--ink-muted)] mt-0.5">{action.desc}</p>
          </div>
          <span className="text-[var(--ink-muted)] text-xs group-hover:text-[var(--accent-secondary)] transition-colors">{"\u2192"}</span>
        </Link>
      ))}
    </div>
  );
}
