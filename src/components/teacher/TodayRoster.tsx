import Link from "next/link";
import { Warning } from "@phosphor-icons/react/dist/ssr";

import ProgramBadge from "@/components/ui/ProgramBadge";
import type { TodayRosterEntry } from "@/lib/teacher/today";

const PRESENCE_STYLE: Record<TodayRosterEntry["presence"], string> = {
  present: "bg-[var(--accent-green)]",
  recent: "bg-[var(--accent-gold)]",
  away: "bg-[var(--ink-faint)]",
};

const PRESENCE_LABEL: Record<TodayRosterEntry["presence"], string> = {
  present: "Active now",
  recent: "Active today",
  away: "Away",
};

export default function TodayRoster({ roster }: { roster: TodayRosterEntry[] }) {
  if (roster.length === 0) {
    return (
      <section className="surface-section p-5">
        <h2 className="font-display text-2xl text-[var(--ink-strong)]">Today</h2>
        <p className="mt-3 rounded-xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
          No managed students in this view. Switch classes via the class switcher above.
        </p>
      </section>
    );
  }

  return (
    <section className="surface-section p-5">
      <header className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
          In class today
        </p>
        <h2 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">Roster</h2>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Presence derived from most recent chat activity — no formal attendance.
        </p>
      </header>

      <ul className="space-y-2">
        {roster.map((entry) => (
          <li key={entry.id}>
            <Link
              href={`/teacher/students/${entry.studentId}`}
              className="flex items-center gap-3 rounded-[1rem] border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 transition-colors hover:bg-[var(--surface-muted)]"
            >
              <span
                aria-label={PRESENCE_LABEL[entry.presence]}
                title={PRESENCE_LABEL[entry.presence]}
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${PRESENCE_STYLE[entry.presence]}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="truncate text-sm font-semibold text-[var(--ink-strong)]">
                    {entry.name}
                  </p>
                  <ProgramBadge programType={entry.programType} size="sm" />
                </div>
                <p className="truncate text-xs text-[var(--ink-muted)]">
                  {entry.activeTask
                    ? `Next: ${entry.activeTask.title}`
                    : entry.lastConversationAt
                      ? `Last chat ${timeAgo(entry.lastConversationAt)}`
                      : "No recent activity"}
                </p>
              </div>
              {entry.highSeverityAlertCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--badge-error-bg)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--badge-error-text)]"
                  title={`${entry.highSeverityAlertCount} high-severity alert${entry.highSeverityAlertCount === 1 ? "" : "s"}`}
                >
                  <Warning size={12} weight="fill" aria-hidden />
                  {entry.highSeverityAlertCount}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function timeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
