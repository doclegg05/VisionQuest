"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * A one-time nudge for students whose SMS opt-in predates verification.
 *
 * Nothing was backfilled when consent became code-verified — a box nobody
 * ticked is not consent — so every student who had texts on before that
 * silently stopped receiving them, including their daily coaching text. From
 * their side nothing changed and nothing announced itself. Settings already
 * explains it, but only to someone who happens to open Settings.
 *
 * Deliberately small: one sentence, one link, one dismiss. It renders only for
 * the exact population it is about (`enabled && !consented`), and the dismissal
 * is per-device in localStorage rather than a column — being reminded again on
 * another device is a smaller cost than a migration for a banner, and the
 * banner disappears for good the moment they finish confirming.
 */
const DISMISS_KEY = "vq.sms-reconsent-dismissed";

export function SmsReconsentNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // A private window, cleared site data or a browser that blocks storage all
    // throw here rather than returning null, so the read cannot be trusted to
    // be a plain lookup.
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // Storage unavailable: show the notice. Repeating it is the safe
      // direction — the alternative is never telling them at all.
    }

    void (async () => {
      try {
        const res = await fetch("/api/notifications/preferences");
        if (!res.ok) return;
        const data: unknown = await res.json();
        const sms = (data as { sms?: { enabled?: boolean; consented?: boolean } }).sms;
        if (!cancelled && sms?.enabled === true && sms.consented === false) setShow(true);
      } catch {
        // A banner is not worth an error state.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  function dismiss() {
    setShow(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Nothing to do; it will come back next visit.
    }
  }

  return (
    <div className="surface-section flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
      <p className="text-sm text-[var(--ink-strong)]">
        Text messages are paused. We need to check your phone number first.
      </p>
      <div className="flex items-center gap-2">
        <Link
          href="/settings"
          prefetch={false}
          className="primary-button inline-flex min-h-11 items-center px-4 py-2.5 text-sm"
        >
          Turn texts back on
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide this message"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
