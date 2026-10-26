"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

/**
 * A one-time nudge for students whose SMS opt-in predates verification.
 *
 * Nothing was backfilled when consent became code-verified — a box nobody
 * ticked is not consent — so every student who had texts on before that
 * silently stopped receiving them, including their daily coaching text. From
 * their side nothing changed and nothing announced itself. Settings already
 * explains it, but only to someone who happens to open Settings.
 *
 * Whether it applies is decided on the SERVER, by the page that renders it
 * (`show`), for two reasons. It began as a client fetch inside
 * DashboardClient, and DashboardClient is also mounted by the teacher's
 * student-detail dashboard — so a teacher looking at a student's page was
 * shown a notice about the teacher's own phone preferences. It is now the
 * student `/dashboard` page alone that decides, from that student's own
 * preference row, and there is no fetch to shift the layout after paint.
 *
 * The dismissal stays per-device in localStorage: being reminded again on
 * another device is a smaller cost than a column and a migration for a
 * banner, and it disappears for good the moment they finish confirming.
 */
const DISMISS_KEY = "vq.sms-reconsent-dismissed";

/**
 * localStorage as an external store, read through `useSyncExternalStore`.
 *
 * The obvious shape — `useState(false)` plus an effect that reads storage —
 * is a cascading render and the lint rule rejects it. It is also the wrong
 * model: the dismissal is state owned by the browser, not by React, which is
 * exactly what this hook exists for. The server snapshot is `false` (not
 * dismissed), so the notice is in the server HTML and nothing shifts for the
 * students it is aimed at; a viewer who dismissed it on this device sees it
 * for the one paint before hydration reads their real answer.
 */
const dismissStore = {
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) {
    dismissStore.listeners.add(listener);
    return () => dismissStore.listeners.delete(listener);
  },
  read(): boolean {
    // A private window, cleared site data, or a browser set to block storage
    // throws here rather than returning null, so this cannot be a plain read.
    // Unreadable storage means "not dismissed": repeating the notice is the
    // safe direction, since the alternative is never telling them at all.
    try {
      return window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  },
  /** Server (and pre-hydration) answer. Must be a stable reference. */
  readServer(): boolean {
    return false;
  },
  dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Nothing to persist; it comes back next visit. The listeners below
      // still fire, so the click still closes it for this page view.
    }
    for (const listener of dismissStore.listeners) listener();
  },
};

export function SmsReconsentNotice({ show }: { show: boolean }) {
  const dismissed = useSyncExternalStore(
    dismissStore.subscribe,
    dismissStore.read,
    dismissStore.readServer,
  );

  if (!show || dismissed) return null;

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
        {/* No aria-label: it would replace the visible words for a voice-control
            user, who says what they see (WCAG 2.5.3 Label in Name). */}
        <button
          type="button"
          onClick={() => dismissStore.dismiss()}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[var(--ink-muted)] hover:text-[var(--ink-strong)]"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
