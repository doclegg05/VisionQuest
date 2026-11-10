"use client";

import { useEffect } from "react";
import { reportClientError } from "@/instrumentation-client";

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
 * The error goes to the reporter that src/instrumentation-client.ts starts
 * after the page has loaded. If this page renders before the SDK has
 * arrived, the error is held and sent once it has; with no DSN nothing was
 * started and nothing is loaded. The server reports a failure during server
 * rendering itself (onRequestError).
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    reportClientError(error);
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
