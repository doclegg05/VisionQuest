import Link from "next/link";

/**
 * Ambient vital-signs rail for the chat-first home (Phase 4).
 *
 * Carries the old dashboard's load-bearing signals beside the Sage
 * conversation: readiness + next gap, today's tasks, alerts, next
 * appointment, overdue orientation, resume nudge. Every card deep-links to
 * its full page — pages are destinations, the conversation is home.
 */

export interface AmbientPanelsProps {
  readinessScore: number;
  nextGap: string | null;
  tasks: { id: string; title: string; dueAt: string | null }[];
  alertCount: number;
  nextAppointment: { title: string; startsAt: string; locationLabel: string | null } | null;
  incompleteOrientationItems: { id: string; label: string }[];
  orientationComplete: boolean;
  resumeCreated: boolean;
  level: number;
  currentStreak: number;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Card({
  href,
  eyebrow,
  children,
}: {
  href: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 transition-colors hover:bg-[var(--surface-interactive)]"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--accent-secondary)]">
        {eyebrow}
      </p>
      <div className="mt-1.5 text-sm text-[var(--ink-strong)]">{children}</div>
    </Link>
  );
}

export function AmbientPanels({
  readinessScore,
  nextGap,
  tasks,
  alertCount,
  nextAppointment,
  incompleteOrientationItems,
  orientationComplete,
  resumeCreated,
  level,
  currentStreak,
}: AmbientPanelsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
      <Card href="/goals" eyebrow="Readiness">
        <span className="text-2xl font-bold">{readinessScore}%</span>
        <span className="ml-2 text-xs text-[var(--ink-muted)]">
          Level {level} · {currentStreak}-day streak
        </span>
        {nextGap && (
          <p className="mt-1 text-xs text-[var(--ink-muted)]">Next up: {nextGap}</p>
        )}
      </Card>

      {alertCount > 0 && (
        <Card href="/appointments" eyebrow="Needs attention">
          <span className="font-semibold text-red-600">
            {alertCount} alert{alertCount === 1 ? "" : "s"} waiting
          </span>
        </Card>
      )}

      {!orientationComplete && incompleteOrientationItems.length > 0 && (
        <Card href="/orientation" eyebrow="Orientation">
          <p className="font-semibold">
            {incompleteOrientationItems.length} item
            {incompleteOrientationItems.length === 1 ? "" : "s"} left
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">
            {incompleteOrientationItems[0].label}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-faint)]">
            Tip: hand Sage a signed form right here in chat.
          </p>
        </Card>
      )}

      {tasks.length > 0 && (
        <Card href="/appointments" eyebrow="Today's tasks">
          <ul className="space-y-1">
            {tasks.slice(0, 3).map((task) => (
              <li key={task.id} className="truncate text-sm">
                • {task.title}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {nextAppointment && (
        <Card href="/appointments" eyebrow="Next appointment">
          <p className="truncate font-semibold">{nextAppointment.title}</p>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
            {formatWhen(nextAppointment.startsAt)}
            {nextAppointment.locationLabel ? ` · ${nextAppointment.locationLabel}` : ""}
          </p>
        </Card>
      )}

      {!resumeCreated && (
        <Card href="/portfolio" eyebrow="Resume">
          <p className="font-semibold">Start your resume</p>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
            Sage can draft it from your goals and certifications.
          </p>
        </Card>
      )}

      <p className="px-1 text-right text-xs text-[var(--ink-faint)]">
        <Link href="/dashboard/classic" className="hover:text-[var(--ink-muted)]">
          Classic view →
        </Link>
      </p>
    </div>
  );
}
