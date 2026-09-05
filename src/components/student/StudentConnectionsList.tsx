"use client";

import { useState } from "react";

import {
  withdrawConfirmation,
  type ConnectionStatus,
} from "@/lib/connect/pipeline-shared";

/**
 * The student's live introductions, each with a way to take it back.
 *
 * This list exists because the approval card promised "You can take it back
 * any time" and there was nowhere to do it: the pending endpoint returned only
 * `proposed` rows and the disclosure log only rows already sent, so between
 * approving and sending the connection appeared on no screen at all. A promise
 * with no button is worse than no promise.
 *
 * Each row says where things stand in one plain sentence, and the confirmation
 * after withdrawing depends on whether the packet had actually gone — telling
 * a student "we told your teacher not to send this" about a packet an employer
 * already read would be a lie they might act on.
 */
export interface StudentConnection {
  id: string;
  jobTitle: string;
  employerName: string;
  status: ConnectionStatus;
  statusPhrase: string;
  sentOn: string | null;
}

export function StudentConnectionsList({
  connections,
  onWithdrawn,
}: {
  connections: StudentConnection[];
  onWithdrawn?: (id: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (connections.length === 0) return null;

  async function withdraw(connection: StudentConnection) {
    setBusyId(connection.id);
    setErrors((current) => ({ ...current, [connection.id]: "" }));
    try {
      const res = await fetch(`/api/connect/${connection.id}/withdraw`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setErrors((current) => ({
          ...current,
          [connection.id]:
            typeof json.error === "string" ? json.error : "That did not work. Try again.",
        }));
        return;
      }
      setDone((current) => ({
        ...current,
        [connection.id]: withdrawConfirmation(connection.status, connection.employerName),
      }));
      onWithdrawn?.(connection.id);
    } catch {
      setErrors((current) => ({
        ...current,
        [connection.id]: "That did not work. Try again.",
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="surface-section p-6" aria-labelledby="your-introductions">
      <h2 id="your-introductions" className="text-lg font-semibold text-[var(--ink-strong)]">
        Your job introductions
      </h2>
      <ul className="mt-4 flex flex-col gap-4">
        {connections.map((connection) => (
          <li key={connection.id} className="rounded-lg border border-[var(--border)] p-4">
            <p className="text-base font-semibold text-[var(--ink-strong)]">
              {connection.jobTitle} at {connection.employerName}
            </p>
            <p className="mt-1 text-base text-[var(--ink-muted)]">{connection.statusPhrase}</p>
            {connection.sentOn && (
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Sent {connection.sentOn}.</p>
            )}

            {done[connection.id] ? (
              <p className="mt-3 text-base font-semibold text-[var(--ink-strong)]" role="status">
                {done[connection.id]}
              </p>
            ) : (
              <>
                {errors[connection.id] && (
                  <p className="mt-2 text-base text-red-600" role="alert">
                    {errors[connection.id]}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => withdraw(connection)}
                  disabled={busyId === connection.id}
                  className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[var(--border)] px-4 py-2 text-base font-semibold text-[var(--ink-strong)] disabled:opacity-50"
                >
                  {busyId === connection.id ? "Working…" : "Take this back"}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
