"use client";

import { useEffect, useState } from "react";

interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

function formatAction(action: string) {
  return action.replaceAll(".", " ");
}

export default function AuditTrail() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/teacher/audit?limit=75");
        if (!res.ok) {
          throw new Error("Failed to load audit trail.");
        }

        const data = await res.json();
        setLogs(data.logs || []);
        setError(null);
      } catch (err) {
        console.error("Failed to load audit trail:", err);
        setError("Could not load audit activity right now.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  if (loading) {
    return <p className="text-sm text-[var(--ink-faint)]">Loading audit trail...</p>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[rgba(18,38,63,0.12)] bg-[var(--surface-raised)]/70 p-6 text-sm text-[var(--ink-muted)]">
        No tracked teacher actions yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {logs.map((log) => (
        <div key={log.id} className="surface-section p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                {formatAction(log.action)}
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--ink-strong)]">
                {log.summary || `${formatAction(log.action)} on ${log.targetType}`}
              </p>
            </div>
            <p className="text-xs text-[var(--ink-muted)]">
              {new Date(log.createdAt).toLocaleString()}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--ink-muted)]">
            {log.actorRole && (
              <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-2 py-1">
                Actor: {log.actorRole}
              </span>
            )}
            <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-2 py-1">
              Target: {log.targetType}
            </span>
            {log.targetId && (
              <span className="rounded-full bg-[rgba(16,37,62,0.06)] px-2 py-1">
                ID: {log.targetId}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
