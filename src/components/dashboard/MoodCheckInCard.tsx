"use client";

import { useState } from "react";

/**
 * Daily mood check-in card for the ambient rail (chat-first home).
 *
 * Five tappable faces on the same 1-10 scale Sage's chat extraction uses,
 * so crisis detection and the teacher mood sparkline read one stream.
 * Optimistic: tapping swaps straight to a quiet "noted" state and POSTs in
 * the background; a failure flips back to the picker with a retry line.
 */

const MOOD_OPTIONS = [
  { score: 2, emoji: "\u{1F61E}", label: "Really low" },
  { score: 4, emoji: "\u{1F641}", label: "Not great" },
  { score: 6, emoji: "\u{1F610}", label: "Okay" },
  { score: 8, emoji: "\u{1F642}", label: "Good" },
  { score: 10, emoji: "\u{1F604}", label: "Great" },
] as const;

type CheckInStatus = "idle" | "saved" | "failed";

export function MoodCheckInCard() {
  const [status, setStatus] = useState<CheckInStatus>("idle");

  async function handlePick(score: number) {
    // Optimistic: show the thank-you right away, then save.
    setStatus("saved");
    try {
      const res = await fetch("/api/mood", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score }),
      });
      if (!res.ok) setStatus("failed");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--accent-secondary)]">
        Daily check-in
      </p>
      {status === "saved" ? (
        <p className="mt-1.5 text-sm text-[var(--ink-muted)]">Thanks — noted ✓</p>
      ) : (
        <>
          <p className="mt-1.5 text-sm font-semibold text-[var(--ink-strong)]">
            How are you feeling today?
          </p>
          {status === "failed" && (
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              That didn&apos;t save. Tap a face to try again.
            </p>
          )}
          <div className="mt-2 grid grid-cols-5 gap-1">
            {MOOD_OPTIONS.map((option) => (
              <button
                key={option.score}
                type="button"
                onClick={() => handlePick(option.score)}
                aria-label={option.label}
                className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors hover:bg-[var(--surface-interactive)]"
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  {option.emoji}
                </span>
                <span className="text-[10px] font-medium text-[var(--ink-muted)]">
                  {option.label}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
