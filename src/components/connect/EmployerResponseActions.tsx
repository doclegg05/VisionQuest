"use client";

import { useState } from "react";

import {
  NOT_NOW_REASONS,
  NOT_NOW_REASON_LABELS,
  type NotNowReason,
} from "@/lib/connect/employer-actions-shared";

/**
 * The employer's three answers.
 *
 * One question on screen at a time: the page opens with three buttons, and
 * choosing one replaces them with just that answer's form. An employer reads
 * this on a phone between other jobs, and a page showing a slot picker, a
 * reason list and a wage box at once is a page nobody finishes.
 *
 * The token is passed in from the server component and echoed in every POST
 * body — the routes require it there as well as in the path.
 */
export interface EmployerSlot {
  startsAt: string;
  label: string;
}

type Mode = "choose" | "interested" | "not_now" | "hired" | "done";

const BUTTON =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 py-2 text-base font-semibold";

export function EmployerResponseActions({
  token,
  slots,
}: {
  token: string;
  slots: EmployerSlot[];
}) {
  const [mode, setMode] = useState<Mode>("choose");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function post(path: string, body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/connect/employer/${token}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, token }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "That did not go through.");
        return false;
      }
      return true;
    } catch {
      setError("That did not go through. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (mode === "done") {
    return (
      <div className="surface-section p-6" role="status">
        <p className="text-lg font-semibold text-[var(--ink-strong)]">Thank you.</p>
        <p className="mt-2 text-base text-[var(--ink-muted)]">{message}</p>
      </div>
    );
  }

  return (
    <div className="surface-section p-6">
      <h2 className="text-lg font-semibold text-[var(--ink-strong)]">What would you like to do?</h2>

      {error && (
        <p className="mt-3 text-base text-red-600" role="alert">
          {error}
        </p>
      )}

      {mode === "choose" && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className={`${BUTTON} bg-[var(--accent-primary)] text-white`}
            onClick={() => setMode("interested")}
          >
            I want to meet them
          </button>
          <button
            type="button"
            className={`${BUTTON} border border-[var(--border)] text-[var(--ink-strong)]`}
            onClick={() => setMode("not_now")}
          >
            Not right now
          </button>
          <button
            type="button"
            className={`${BUTTON} border border-[var(--border)] text-[var(--ink-strong)]`}
            onClick={() => setMode("hired")}
          >
            I hired them
          </button>
        </div>
      )}

      {mode === "interested" && (
        <div className="mt-4">
          <h3 className="text-base font-semibold text-[var(--ink-strong)]">Pick a time to meet</h3>
          {slots.length === 0 ? (
            <p className="mt-2 text-base text-[var(--ink-muted)]">
              There are no open times right now. Reply to the email and we will set one up.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {slots.map((slot) => (
                <li key={slot.startsAt}>
                  <button
                    type="button"
                    disabled={saving}
                    className={`${BUTTON} w-full border border-[var(--border)] text-[var(--ink-strong)] disabled:opacity-50`}
                    onClick={async () => {
                      if (await post("interested", { startsAt: slot.startsAt })) {
                        setMessage(`We booked ${slot.label}. You will get a reminder.`);
                        setMode("done");
                      }
                    }}
                  >
                    {slot.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <BackButton onClick={() => setMode("choose")} />
        </div>
      )}

      {mode === "not_now" && (
        <NotNowForm
          saving={saving}
          onBack={() => setMode("choose")}
          onSubmit={async (reason, note) => {
            if (await post("not-now", { reason, note })) {
              setMessage("We told the teacher. Thank you for looking.");
              setMode("done");
            }
          }}
        />
      )}

      {mode === "hired" && (
        <HiredForm
          saving={saving}
          onBack={() => setMode("choose")}
          onSubmit={async (startDate, hourlyWage) => {
            if (await post("hired", { startDate, hourlyWage })) {
              setMessage("That is great news. We recorded it.");
              setMode("done");
            }
          }}
        />
      )}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 min-h-[44px] text-base font-semibold text-[var(--ink-muted)] underline"
    >
      Go back
    </button>
  );
}

function NotNowForm({
  saving,
  onBack,
  onSubmit,
}: {
  saving: boolean;
  onBack: () => void;
  onSubmit: (reason: NotNowReason, note: string | undefined) => void;
}) {
  const [reason, setReason] = useState<NotNowReason>("not_hiring_now");
  const [note, setNote] = useState("");

  return (
    <div className="mt-4">
      <label htmlFor="not-now-reason" className="text-base font-semibold text-[var(--ink-strong)]">
        Can you tell us why? (You do not have to.)
      </label>
      <select
        id="not-now-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value as NotNowReason)}
        className="mt-2 min-h-[44px] w-full rounded-lg border border-[var(--border)] px-3 py-2 text-base"
      >
        {NOT_NOW_REASONS.map((value) => (
          <option key={value} value={value}>
            {NOT_NOW_REASON_LABELS[value]}
          </option>
        ))}
      </select>

      {reason === "other" && (
        <>
          <label htmlFor="not-now-note" className="mt-4 block text-base text-[var(--ink-strong)]">
            Anything else? (200 letters or fewer)
          </label>
          <input
            id="not-now-note"
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
            className="mt-2 min-h-[44px] w-full rounded-lg border border-[var(--border)] px-3 py-2 text-base"
          />
        </>
      )}

      <button
        type="button"
        disabled={saving}
        onClick={() => onSubmit(reason, note.trim() || undefined)}
        className={`${BUTTON} mt-4 w-full bg-[var(--accent-primary)] text-white disabled:opacity-50`}
      >
        Send
      </button>
      <BackButton onClick={onBack} />
    </div>
  );
}

function HiredForm({
  saving,
  onBack,
  onSubmit,
}: {
  saving: boolean;
  onBack: () => void;
  onSubmit: (startDate: string, hourlyWage: number) => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [wage, setWage] = useState("");

  const wageNumber = Number(wage);
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && wageNumber > 0;
  const [touched, setTouched] = useState(false);

  return (
    <div className="mt-4">
      <label htmlFor="hired-start" className="block text-base font-semibold text-[var(--ink-strong)]">
        What day do they start?
      </label>
      <input
        id="hired-start"
        type="date"
        value={startDate}
        onChange={(event) => setStartDate(event.target.value)}
        className="mt-2 min-h-[44px] w-full rounded-lg border border-[var(--border)] px-3 py-2 text-base"
      />

      <label htmlFor="hired-wage" className="mt-4 block text-base font-semibold text-[var(--ink-strong)]">
        What do they make an hour?
      </label>
      <input
        id="hired-wage"
        type="number"
        inputMode="decimal"
        min="1"
        max="200"
        step="0.25"
        value={wage}
        onChange={(event) => setWage(event.target.value)}
        className="mt-2 min-h-[44px] w-full rounded-lg border border-[var(--border)] px-3 py-2 text-base"
      />

      {/* Never a silently dead button: say WHY it cannot be pressed. The
          first cut just disabled it, which leaves an employer tapping a
          control that does nothing and no way to find out what is missing. */}
      {touched && !ready && (
        <p className="mt-3 text-base text-[var(--ink-strong)]" role="alert">
          Enter a start date and an hourly wage above $0.
        </p>
      )}

      <button
        type="button"
        disabled={saving}
        onClick={() => {
          setTouched(true);
          if (ready) onSubmit(startDate, wageNumber);
        }}
        className={`${BUTTON} mt-4 w-full bg-[var(--accent-primary)] text-white disabled:opacity-50`}
      >
        Send
      </button>
      <BackButton onClick={onBack} />
    </div>
  );
}
