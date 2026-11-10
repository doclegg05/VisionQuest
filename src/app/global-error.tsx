"use client";

import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Shown when the root layout itself fails (H1, 2026-11-10). It replaces
 * that layout, so it brings its own <html> and <body>, and the root
 * stylesheet may be missing: the page has to read as plain HTML too. The
 * words match src/app/error.tsx.
 *
 * The SDK is fetched only when a DSN is set, so without one this page loads
 * nothing extra. If it renders before src/instrumentation-client.ts has
 * started the browser SDK, the capture has no client and is dropped; the
 * server reports a failure during server rendering (onRequestError).
 */
function reportError(error: Error): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  import("@sentry/nextjs")
    .then(({ captureException }) => captureException(error))
    .catch((loadError: unknown) => {
      console.error("Error reporting could not start", loadError instanceof Error ? loadError.name : typeof loadError);
    });
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-[var(--surface-base)] text-[var(--ink-strong)]">
        <main
          id="main-content"
          className="flex min-h-screen flex-col items-center justify-center px-4 text-center"
        >
          <h1 className="font-display text-4xl text-[var(--ink-strong)]">Something went wrong</h1>
          <p className="mt-3 text-lg text-[var(--ink-muted)]">
            An unexpected error occurred. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 inline-flex min-h-11 items-center rounded-full bg-success px-6 py-2.5 text-sm font-semibold text-on-success transition hover:brightness-95"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
