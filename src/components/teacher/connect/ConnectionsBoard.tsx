"use client";

import { useState } from "react";

/**
 * The pipeline board: every live connection, and the two actions only an
 * instructor can take.
 *
 * Send is the moment a student's information leaves the program, so it is a
 * two-step: the row shows the frozen packet's field list and the contact who
 * would receive it, and the button appears only after "Review what gets sent".
 * A one-tap Send next to a list of names is how the wrong packet goes out.
 *
 * Close asks for a reason because the student is notified of it, and "closed"
 * with no explanation tells them nothing.
 */
export interface ConnectionRow {
  id: string;
  studentName: string;
  jobTitle: string;
  employerName: string;
  status: string;
  statusPhrase: string;
  /** Grade-6 labels from the frozen packet — what the student approved. */
  fields: string[];
  contactName: string | null;
  canSend: boolean;
  canClose: boolean;
}

const BUTTON =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 py-1.5 text-sm font-semibold";

export function ConnectionsBoard({ connections }: { connections: ConnectionRow[] }) {
  const [rows, setRows] = useState(connections);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (rows.length === 0) {
    return (
      <section aria-labelledby="connections-heading" className="theme-card rounded-xl p-5">
        <h2 id="connections-heading" className="text-base font-semibold text-[var(--ink-strong)]">
          Introductions
        </h2>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          None yet. Use Introduce on the students board to start one.
        </p>
      </section>
    );
  }

  async function act(id: string, path: string, body?: Record<string, unknown>) {
    setBusy(id);
    setErrors((current) => ({ ...current, [id]: "" }));
    try {
      const res = await fetch(`/api/teacher/connect/connections/${id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors((current) => ({
          ...current,
          [id]: typeof json.error === "string" ? json.error : "That did not work.",
        }));
        return false;
      }
      setRows((current) => current.filter((row) => row.id !== id));
      return true;
    } catch {
      setErrors((current) => ({ ...current, [id]: "That did not work." }));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="connections-heading" className="theme-card rounded-xl p-5">
      <h2 id="connections-heading" className="text-base font-semibold text-[var(--ink-strong)]">
        Introductions ({rows.length})
      </h2>

      <ul className="mt-4 flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.id} className="theme-card-subtle rounded-lg p-4">
            <p className="text-sm font-semibold text-[var(--ink-strong)]">
              {row.studentName} → {row.employerName}
            </p>
            <p className="mt-0.5 text-sm text-[var(--ink-muted)]">
              {row.jobTitle}. {row.statusPhrase}
            </p>

            {errors[row.id] && (
              <p className="mt-2 text-sm text-red-600" role="alert">
                {errors[row.id]}
              </p>
            )}

            {reviewing === row.id && (
              <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
                <p className="text-sm font-semibold text-[var(--ink-strong)]">
                  This is what {row.contactName ?? "the contact"} would get:
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {row.fields.map((field) => (
                    <li key={field} className="text-sm text-[var(--ink-muted)]">
                      {field}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busy === row.id}
                  onClick={() => act(row.id, "send")}
                  className={`${BUTTON} mt-3 bg-[var(--accent-primary)] text-white disabled:opacity-50`}
                >
                  {busy === row.id ? "Sending…" : "Send it"}
                </button>
              </div>
            )}

            {closing === row.id && (
              <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
                <label
                  htmlFor={`close-${row.id}`}
                  className="block text-sm font-semibold text-[var(--ink-strong)]"
                >
                  Why are you closing this? The student sees your reason.
                </label>
                <input
                  id={`close-${row.id}`}
                  value={notes[row.id] ?? ""}
                  maxLength={500}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [row.id]: event.target.value }))
                  }
                  className="mt-2 min-h-[44px] w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={busy === row.id || !(notes[row.id] ?? "").trim()}
                  onClick={() => act(row.id, "close", { reason: notes[row.id] })}
                  className={`${BUTTON} mt-3 border border-[var(--border)] text-[var(--ink-strong)] disabled:opacity-50`}
                >
                  {busy === row.id ? "Closing…" : "Close it"}
                </button>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {row.canSend && reviewing !== row.id && (
                <button
                  type="button"
                  onClick={() => setReviewing(row.id)}
                  className={`${BUTTON} border border-[var(--border)] text-[var(--ink-strong)]`}
                >
                  Review what gets sent
                </button>
              )}
              {row.canClose && closing !== row.id && (
                <button
                  type="button"
                  onClick={() => setClosing(row.id)}
                  className={`${BUTTON} text-[var(--ink-muted)] underline`}
                >
                  Close
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
