"use client";

import { useMemo, type ReactNode } from "react";
import type { InterventionQueueEntry } from "@/lib/teacher/intervention-queue";
import { countInactivityStages } from "@/lib/teacher/queue-issue-groups";
import { countUrgentStudents } from "./queue-alert-target";

const TOOL = "inline-flex min-h-11 items-center rounded-full px-4 text-xs font-semibold transition-colors";

export interface InterventionQueueHeaderProps {
  /**
   * The eyebrow and the title. They stay in the panel's file, where globals.teacher-role-text.test.ts reads the
   * eyebrow's color class.
   */
  children: ReactNode;
  queue: readonly Pick<InterventionQueueEntry, "name" | "openAlerts">[];
  /** The list is on screen. The counts and Ask Sage show only then. */
  listShown: boolean;
  /** True for an alert whose line shows as done. It no longer counts as urgent. */
  isDone: (alertId: string) => boolean;
  /** A done line is waiting for a reload to clear it, so the instructor gets a way to reload. */
  refreshOffered: boolean;
  onRefresh: () => void;
  onAskSage: () => void;
}

/** The intervention queue's heading row: the title the panel hands in, the counts under it, and the tools. */
export function InterventionQueueHeader({
  children,
  queue,
  listShown,
  isDone,
  refreshOffered,
  onRefresh,
  onAskSage,
}: InterventionQueueHeaderProps) {
  const urgentCount = countUrgentStudents(queue, isDone);
  const inactivityStages = useMemo(() => countInactivityStages(queue), [queue]);
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        {children}
        {listShown ? (
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {queue.length} student{queue.length === 1 ? "" : "s"} need follow-up
            {urgentCount > 0 ? ` · ${urgentCount} urgent` : ""}
          </p>
        ) : null}
        {inactivityStages.length > 0 ? (
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
            Inactive: {inactivityStages.map((stage) => `${stage.label} ${stage.count}`).join(" · ")}
          </p>
        ) : null}
      </div>
      {listShown || refreshOffered ? (
        <div className="flex flex-wrap items-center gap-2">
          {listShown ? (
            <button
              type="button"
              onClick={onAskSage}
              className={`${TOOL} bg-[var(--accent-strong)] text-[var(--on-accent)] hover:bg-[var(--accent-green)]/90`}
            >
              Ask Sage to prioritize
            </button>
          ) : null}
          {/* Second, so Ask Sage stays where it is on a phone when this appears. */}
          {refreshOffered ? (
            <button
              type="button"
              onClick={onRefresh}
              className={`${TOOL} border border-[var(--border)] text-[var(--ink-strong)] hover:bg-[var(--surface-muted)]`}
            >
              Refresh list
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
