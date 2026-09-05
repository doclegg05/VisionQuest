"use client";

import { useEffect, useState } from "react";

import {
  ConnectionApprovalCard,
  isDismissed,
  type PendingConnection,
} from "./ConnectionApprovalCard";
import {
  StudentConnectionsList,
  type StudentConnection,
} from "./StudentConnectionsList";

/**
 * The student's Connect surface on the Career page: one card to answer, and
 * the list of everything already answered.
 *
 * ONE card at a time (design spec §7). A student with three proposals sees the
 * oldest one and nothing else — a stack of consent decisions is a stack nobody
 * reads, and each of these gives away something real about them. "Not right
 * now" hides one for a week, and the next proposal takes its place.
 *
 * Renders nothing at all when there is nothing waiting and nothing live, and
 * nothing when the pilot is off for their class: `/api/connect/pending`
 * returns empty lists rather than an error in that case, so a student never
 * sees a feature they cannot use.
 */
export function PendingConnectionsPanel() {
  const [pending, setPending] = useState<PendingConnection[]>([]);
  const [active, setActive] = useState<StudentConnection[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/connect/pending")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        if (cancelled) return;
        const rows: PendingConnection[] = json?.data?.pending ?? [];
        setPending(rows);
        setActive(json?.data?.active ?? []);
        // Read once, after the rows arrive: localStorage is per-viewer and
        // unavailable during server render.
        setDismissedIds(rows.filter((row) => isDismissed(row.id)).map((row) => row.id));
      })
      .catch(() => {
        // Silent: an unreachable endpoint must not put an error banner on the
        // Career page about a feature this student may not even be in.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Oldest first, matching "one at a time": the proposal that has been waiting
  // longest is the one to answer.
  const [next] = pending.filter((row) => !dismissedIds.includes(row.id));

  if (!next && active.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {next && (
        <ConnectionApprovalCard
          connection={next}
          onApproved={(id) => setPending((rows) => rows.filter((row) => row.id !== id))}
          onDismiss={(id) => setDismissedIds((ids) => [...ids, id])}
        />
      )}
      <StudentConnectionsList
        connections={active}
        onWithdrawn={(id) => setActive((rows) => rows.filter((row) => row.id !== id))}
      />
    </div>
  );
}
