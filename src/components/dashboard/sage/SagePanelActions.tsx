"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Dismiss / refresh controls for the student's own Sage panel. Tiny client
 * island — the panel itself stays server-rendered.
 */
export function SagePanelActions({ panelId }: { panelId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function dismiss() {
    setPending(true);
    try {
      const res = await fetch("/api/sage/panel/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panelId }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        setNote("Couldn't hide this right now.");
      }
    } catch {
      setNote("Couldn't hide this right now.");
    } finally {
      setPending(false);
    }
  }

  async function refresh() {
    setPending(true);
    setNote(null);
    try {
      const res = await fetch("/api/sage/panel/refresh", { method: "POST" });
      const body = (await res.json()) as { data?: { status?: string } };
      if (res.ok && body.data?.status === "queued") {
        setNote("Sage is on it — check back in a few minutes.");
      } else if (res.ok) {
        setNote("Sage already refreshed recently. Try again later.");
      } else {
        setNote("Couldn't ask for a refresh right now.");
      }
    } catch {
      setNote("Couldn't ask for a refresh right now.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex items-center gap-2 text-xs">
      {note && <span className="text-[var(--ink-muted)]">{note}</span>}
      <button
        type="button"
        onClick={refresh}
        disabled={pending}
        aria-label="Ask Sage for a fresh set of suggestions"
        className="rounded px-1.5 py-1 text-[var(--ink-faint)] hover:text-[var(--ink-muted)] disabled:opacity-50"
      >
        Refresh
      </button>
      <button
        type="button"
        onClick={dismiss}
        disabled={pending}
        aria-label="Hide Sage's suggestions for today"
        className="rounded px-1.5 py-1 text-[var(--ink-faint)] hover:text-[var(--ink-muted)] disabled:opacity-50"
      >
        Hide for today
      </button>
    </span>
  );
}
