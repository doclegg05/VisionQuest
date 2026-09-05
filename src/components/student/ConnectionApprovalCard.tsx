"use client";

import { useState } from "react";

import { ReadAloudButton } from "@/components/ui/ReadAloudButton";

/**
 * One introduction, one screen, one action.
 *
 * This card is the consent moment for the whole feature: nothing about this
 * student reaches an employer until the button below is tapped. So it obeys
 * three rules that are not style preferences:
 *
 *   1. The FIELD LIST is shown in full, in the student's words, above the
 *      button. Informed consent means the list is on the screen where the
 *      decision is made — not on a linked page, not behind "see details".
 *   2. One action. "Not now" leaves the card alone rather than deciding
 *      anything, because a student who is unsure should be able to walk away
 *      without their hesitation being recorded as a refusal.
 *   3. Read-aloud, on-device only (ReadAloudButton refuses a network voice).
 *      A grade-5 reader must not have to decode a disclosure notice.
 */
export interface PendingConnection {
  id: string;
  jobTitle: string;
  employerName: string;
  location: string;
  fields: string[];
  endorsement: string;
}

export function ConnectionApprovalCard({
  connection,
  onApproved,
}: {
  connection: PendingConnection;
  onApproved?: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spokenText = [
    `Your teacher wants to send your information to ${connection.employerName} for the ${connection.jobTitle} job in ${connection.location}.`,
    `Here is what they would send: ${connection.fields.join(", ")}.`,
    connection.endorsement ? `Your teacher wrote: ${connection.endorsement}` : "",
    "Nothing is sent until you say OK.",
  ]
    .filter(Boolean)
    .join(" ");

  async function approve() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/connect/${connection.id}/approve`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(typeof json.error === "string" ? json.error : "That did not save. Try again.");
        return;
      }
      setApproved(true);
      onApproved?.(connection.id);
    } catch {
      setError("That did not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (approved) {
    return (
      <div className="surface-section p-6" role="status">
        <p className="text-lg font-semibold text-[var(--ink-strong)]">You said OK.</p>
        <p className="mt-2 text-base text-[var(--ink-muted)]">
          Your teacher will send it to {connection.employerName}. You can take it back any time.
        </p>
      </div>
    );
  }

  return (
    <div className="surface-section p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--ink-strong)]">
          Can we send your information to {connection.employerName}?
        </h2>
        <ReadAloudButton text={spokenText} />
      </div>

      <p className="mt-3 text-base text-[var(--ink-strong)]">
        It is for the {connection.jobTitle} job in {connection.location}.
      </p>

      <h3 className="mt-5 text-base font-semibold text-[var(--ink-strong)]">
        This is what they would get:
      </h3>
      <ul className="mt-2 flex flex-col gap-2">
        {connection.fields.map((field) => (
          <li key={field} className="text-base text-[var(--ink-strong)]">
            • {field}
          </li>
        ))}
      </ul>

      {connection.endorsement && (
        <div className="mt-5">
          <h3 className="text-base font-semibold text-[var(--ink-strong)]">
            What your teacher wrote:
          </h3>
          <p className="mt-2 text-base text-[var(--ink-muted)]">{connection.endorsement}</p>
        </div>
      )}

      <p className="mt-5 text-base text-[var(--ink-strong)]">
        Nothing is sent until you say OK. You can take it back later.
      </p>

      {error && (
        <p className="mt-3 text-base text-red-600" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={approve}
        disabled={saving}
        className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-base font-semibold text-white disabled:opacity-50 sm:w-auto"
      >
        {saving ? "Saving…" : "OK, send it"}
      </button>
    </div>
  );
}
