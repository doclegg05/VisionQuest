"use client";

import { useEffect, useState } from "react";

import {
  ConnectionApprovalCard,
  type PendingConnection,
} from "./ConnectionApprovalCard";

/**
 * The student's waiting introductions, on the Career page.
 *
 * ONE card at a time (design spec §7). A student with three proposals sees the
 * oldest one and nothing else — a stack of consent decisions is a stack nobody
 * reads, and each of these gives away something real about them.
 *
 * Renders nothing at all when there is nothing waiting, and nothing when the
 * pilot is off for their class: `/api/connect/pending` returns an empty list
 * rather than an error in that case, so a student never sees a feature they
 * cannot use.
 */
export function PendingConnectionsPanel() {
  const [pending, setPending] = useState<PendingConnection[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/connect/pending")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json) => {
        if (!cancelled) setPending(json?.data?.pending ?? []);
      })
      .catch(() => {
        // Silent: an unreachable endpoint must not put an error banner on the
        // Career page about a feature this student may not even be in.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [next] = pending;
  if (!next) return null;

  return (
    <ConnectionApprovalCard
      connection={next}
      onApproved={(id) => setPending((rows) => rows.filter((row) => row.id !== id))}
    />
  );
}
