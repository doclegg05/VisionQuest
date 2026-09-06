"use client";

import { useState } from "react";

import { ReadAloudButton } from "@/components/ui/ReadAloudButton";
import {
  PACKET_FIELD_LABELS,
  SUBSIDY_FALLBACK_LINE,
  type PacketFieldKey,
} from "@/lib/connect/packet-shared";

/**
 * One introduction, one screen, one action.
 *
 * This card is the consent moment for the whole feature: nothing about this
 * student reaches an employer until the button below is tapped. So it obeys
 * four rules that are not style preferences:
 *
 *   1. It shows the VALUES, not just the field names. The employer page renders
 *      the availability line, the start date, the cert names and the
 *      endorsement; a card that listed only "The days and times you can work"
 *      would be asking a student to consent to a category. Both surfaces read
 *      the same frozen packet, and a test asserts they agree.
 *   2. Everything is above the button. Informed consent means the list and the
 *      decision are on one screen — not behind "see details".
 *   3. Two ways out, and only one of them is a decision. "Not right now" hides
 *      the card locally and records nothing; a student who is unsure must be
 *      able to walk away without their hesitation becoming a refusal.
 *   4. Read-aloud, on-device only (ReadAloudButton refuses a network voice).
 */
export interface PendingConnection {
  id: string;
  jobTitle: string;
  employerName: string;
  location: string;
  /**
   * PACKET FIELD KEYS, not labels.
   *
   * The API used to send the rendered labels and this file mapped them back to
   * keys by reverse lookup, which made the two sides agree only as long as
   * every label string stayed byte-identical across a server file and a client
   * file. One copy-edit to a label — the exact thing the readability gate
   * encourages — would have silently dropped that row from the card while the
   * employer still received the value. Keys travel; labels are rendered here.
   */
  fields: PacketFieldKey[];
  endorsement: string;
  candidateName: string;
  certifications: string[];
  availabilitySummary: string;
  earliestStart: string | null;
  subsidyLine: string | null;
  hasResume: boolean;
}

/** Per-connection dismissal, so "Not right now" does not re-nag every visit. */
const DISMISS_PREFIX = "vq.connect.dismissed.";
export const DISMISS_DAYS = 7;

export function dismissalKey(connectionId: string): string {
  return `${DISMISS_PREFIX}${connectionId}`;
}

/** True when this card was dismissed within the last DISMISS_DAYS. */
export function isDismissed(connectionId: string, now: number = Date.now()): boolean {
  try {
    const raw = window.localStorage.getItem(dismissalKey(connectionId));
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return now - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    // Private windows, cleared site data, or a browser blocking storage. A
    // card that cannot remember a dismissal shows again, which is the safe
    // direction: it is a nudge, not a decision.
    return false;
  }
}

function rememberDismissal(connectionId: string): void {
  try {
    window.localStorage.setItem(dismissalKey(connectionId), String(Date.now()));
  } catch {
    // Same reason. Failing to remember costs one extra look at the card.
  }
}

/** The value the employer would actually see for each approved field. */
function valueFor(field: PacketFieldKey, connection: PendingConnection): string | null {
  switch (field) {
    case "candidate_name":
      return connection.candidateName || null;
    case "resume":
      return connection.hasResume
        ? "Your résumé, written for this job"
        : // Honest rather than blank: tailoring can fail or time out, and a
          // student must not consent to a document that is not there.
          "We are still putting your résumé together. Your teacher will check it before they send it.";
    case "verified_certifications":
      return connection.certifications.join(", ") || null;
    case "availability":
      return connection.availabilitySummary || null;
    case "earliest_start":
      return connection.earliestStart;
    case "endorsement":
      return connection.endorsement || null;
    case "subsidy_line":
      return connection.subsidyLine ?? SUBSIDY_FALLBACK_LINE;
  }
}

export function ConnectionApprovalCard({
  connection,
  onApproved,
  onDismiss,
}: {
  connection: PendingConnection;
  onApproved?: (id: string) => void;
  onDismiss?: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keys = connection.fields;
  const rows = keys.flatMap((key) => {
    const value = valueFor(key, connection);
    return value ? [{ key, label: PACKET_FIELD_LABELS[key], value }] : [];
  });

  const spokenText = [
    `Your teacher wants to send your information to ${connection.employerName} for the ${connection.jobTitle} job in ${connection.location}.`,
    `Here is what they would send. ${rows.map((row) => `${row.label}: ${row.value}`).join(". ")}.`,
    "Saying OK also lets your teacher ask about other jobs later.",
    "Nothing is sent until you say OK.",
  ].join(" ");

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

  if (dismissed) {
    return (
      <div className="surface-section p-6" role="status">
        <p className="text-base text-[var(--ink-strong)]">
          That&rsquo;s OK. This will still be here if you change your mind.
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
      <dl className="mt-2 flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.key}>
            <dt className="text-sm font-semibold text-[var(--ink-muted)]">{row.label}</dt>
            <dd className="mt-0.5 text-base text-[var(--ink-strong)]">{row.value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-5 text-base text-[var(--ink-strong)]">
        Nothing is sent until you say OK. You can take it back later.
      </p>
      <p className="mt-2 text-base text-[var(--ink-muted)]">
        Saying OK also lets your teacher ask about other jobs later. You will always see a card
        like this first, and you can turn this off any time in Settings.
      </p>

      {error && (
        <p className="mt-3 text-base text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={approve}
          disabled={saving}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-base font-semibold text-white disabled:opacity-50 sm:w-auto"
        >
          {saving ? "Saving…" : "OK, send it"}
        </button>
        <button
          type="button"
          onClick={() => {
            rememberDismissal(connection.id);
            setDismissed(true);
            onDismiss?.(connection.id);
          }}
          className="inline-flex min-h-[44px] items-center justify-center text-base font-semibold text-[var(--ink-muted)] underline"
        >
          Not right now
        </button>
      </div>
    </div>
  );
}
