"use client";

import { useEffect } from "react";

interface SegmentErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
  message: string;
  backHref?: string;
  backLabel?: string;
}

/**
 * Shared per-segment error boundary UI. Each student route segment exports a
 * thin `error.tsx` that renders this with feature-specific copy, so a failure
 * in one feature shows a recoverable, screen-reader-announced message instead
 * of a generic dead-end. Plain language for a low-literacy audience.
 */
export function SegmentError({
  error,
  reset,
  title,
  message,
  backHref = "/dashboard",
  backLabel = "Go to dashboard",
}: SegmentErrorProps) {
  useEffect(() => {
    console.error(`[segment error] ${title}:`, error);
  }, [error, title]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--surface-raised)]">
        <span aria-hidden="true" className="text-2xl">⚠️</span>
      </div>
      <div role="alert" className="space-y-1">
        <h1 className="text-lg font-semibold text-[var(--ink-strong)]">{title}</h1>
        <p className="max-w-sm text-sm text-[var(--ink-muted)]">{message}</p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-full bg-[var(--accent-strong)] px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Try again
        </button>
        <a
          href={backHref}
          className="rounded-full border border-[var(--border)] px-5 py-2 text-sm font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-raised)]"
        >
          {backLabel}
        </a>
      </div>
    </div>
  );
}
