"use client";

import { useEffect, useRef, useState } from "react";

interface BirthdatePromptModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Dialog shown right after a student finishes orientation, asking them to
 * set a birthdate if one isn't on file. Appears once per completion. Save
 * hits POST /api/settings/profile; Skip closes without writing.
 *
 * The copy is intentionally reassuring — adult learners in SPOKES are
 * sometimes anxious about data collection, so we explain why we ask and
 * keep Skip as a first-class option.
 */
export default function BirthdatePromptModal({
  open,
  onClose,
  onSaved,
}: BirthdatePromptModalProps) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Capture focus when opened, restore on close.
  useEffect(() => {
    if (!open) return;
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    setTimeout(() => dateInputRef.current?.focus(), 0);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      lastFocusedRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const today = new Date();
  const maxDate = today.toISOString().slice(0, 10);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ birthDate: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Couldn't save. Please try again.");
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="birthdate-prompt-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl bg-[var(--surface-raised)] p-6 shadow-2xl"
      >
        <p className="mb-1 text-2xl">🎂</p>
        <h2
          id="birthdate-prompt-title"
          className="mb-1 text-lg font-semibold text-[var(--ink-strong)]"
        >
          One last thing — your birthday
        </h2>
        <p className="mb-5 text-sm text-[var(--ink-muted)]">
          SPOKES reports enrollment to DoHS using your age, so having your
          birthdate on file helps your teacher keep your record complete.
          You can skip for now and add it later from Settings.
        </p>

        <label className="block text-xs font-medium text-[var(--ink-muted)]">
          Birthdate
        </label>
        <input
          ref={dateInputRef}
          type="date"
          max={maxDate}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-base)] px-3 py-2.5 text-sm text-[var(--ink-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]"
          aria-describedby={error ? "birthdate-prompt-error" : undefined}
        />

        {error && (
          <p
            id="birthdate-prompt-error"
            role="alert"
            className="mt-2 text-xs text-red-600"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-full border border-[var(--border)] bg-[var(--surface-base)] px-4 py-2 text-sm font-medium text-[var(--ink-muted)] hover:bg-[var(--surface-overlay)] disabled:opacity-50"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!value || saving}
            className="rounded-full bg-[var(--accent-strong)] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
