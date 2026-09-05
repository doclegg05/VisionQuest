"use client";

import { useState } from "react";

/**
 * "Introduce" — the instructor's half of Match & Connect Task 4.3.
 *
 * It proposes and stops. The student then sees a card with the exact packet
 * field list and taps OK; only after that does a Send button do anything, and
 * `sendConnection` refuses every other status. So this button cannot, on its
 * own, cause anything to leave the program — which is why it is a single tap
 * with no confirmation dialog in front of it.
 *
 * On success it says what happens next rather than "Done": an instructor who
 * thinks they just sent a résumé will not go looking for the student's
 * approval.
 */
export function ProposeConnectionButton({
  studentId,
  jobLeadId,
  jobTitle,
}: {
  studentId: string;
  jobLeadId: string;
  jobTitle: string;
}) {
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "done") {
    return (
      <p className="mt-1 text-sm font-semibold text-[var(--ink-strong)]" role="status">
        Asked. They will see a card to approve what gets sent.
      </p>
    );
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        disabled={state === "saving"}
        aria-label={`Introduce this student for ${jobTitle}`}
        onClick={async () => {
          setState("saving");
          setError(null);
          try {
            const res = await fetch("/api/teacher/connect/connections", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ studentId, jobLeadId }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
              setError(typeof json.error === "string" ? json.error : "That did not work.");
              setState("idle");
              return;
            }
            setState("done");
          } catch {
            setError("That did not work.");
            setState("idle");
          }
        }}
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--ink-strong)] disabled:opacity-50"
      >
        {state === "saving" ? "Asking…" : "Introduce"}
      </button>
      {error && (
        <p className="mt-1 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
