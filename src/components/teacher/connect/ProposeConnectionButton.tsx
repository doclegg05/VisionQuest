"use client";

import { useState } from "react";

import { MAX_ENDORSEMENT_CHARS } from "@/lib/connect/endorsement-shared";

/**
 * "Introduce" — the instructor's half of Match & Connect Task 4.3.
 *
 * It proposes and stops. The student then sees a card with the exact packet
 * contents and taps OK; only after that does Send do anything, and
 * `sendConnection` refuses every other status. So this cannot, on its own,
 * cause anything to leave the program.
 *
 * The endorsement is written HERE, before the student sees the card, because
 * the packet is frozen at approval — a paragraph added afterwards would be one
 * the student never agreed to send. "Draft with Sage" fills the box from
 * verified facts only, on the local model, and refuses its own draft if it
 * asserts anything the records do not support; the instructor edits it either
 * way, and that edit is the control.
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
  const [open, setOpen] = useState(false);
  const [endorsement, setEndorsement] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "drafting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);

  if (state === "done") {
    return (
      <p className="mt-1 text-sm font-semibold text-[var(--ink-strong)]" role="status">
        Asked. They will see a card to approve what gets sent.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Introduce this student for ${jobTitle}`}
        className="mt-1 inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--ink-strong)]"
      >
        Introduce
      </button>
    );
  }

  const textareaId = `endorsement-${jobLeadId}-${studentId}`;

  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] p-3">
      <label htmlFor={textareaId} className="block text-sm font-semibold text-[var(--ink-strong)]">
        Say something about them for the employer (optional)
      </label>
      <textarea
        id={textareaId}
        value={endorsement}
        maxLength={MAX_ENDORSEMENT_CHARS}
        rows={3}
        onChange={(event) => setEndorsement(event.target.value)}
        className="mt-2 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
      />
      <p className="mt-1 text-xs text-[var(--ink-muted)]">
        {endorsement.length} of {MAX_ENDORSEMENT_CHARS} letters. The student sees this before
        anything is sent.
      </p>

      {draftNote && (
        <p className="mt-2 text-sm text-[var(--ink-muted)]" role="status">
          {draftNote}
        </p>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={state !== "idle"}
          onClick={async () => {
            setState("drafting");
            setError(null);
            setDraftNote(null);
            try {
              const res = await fetch("/api/teacher/connect/connections/endorsement-draft", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ studentId, instructorNotes: endorsement || undefined }),
              });
              const json = await res.json().catch(() => ({}));
              if (!res.ok) {
                setError(typeof json.error === "string" ? json.error : "That did not work.");
                return;
              }
              if (json.data?.draft) setEndorsement(json.data.draft);
              if (json.data?.reason) setDraftNote(json.data.reason);
            } catch {
              setError("That did not work.");
            } finally {
              setState("idle");
            }
          }}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--ink-strong)] disabled:opacity-50"
        >
          {state === "drafting" ? "Drafting…" : "Draft with Sage"}
        </button>

        <button
          type="button"
          disabled={state !== "idle"}
          onClick={async () => {
            setState("saving");
            setError(null);
            try {
              const res = await fetch("/api/teacher/connect/connections", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  studentId,
                  jobLeadId,
                  endorsement: endorsement.trim() || undefined,
                }),
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
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {state === "saving" ? "Asking…" : "Ask the student"}
        </button>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex min-h-[44px] items-center justify-center px-2 text-sm font-semibold text-[var(--ink-muted)] underline"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
