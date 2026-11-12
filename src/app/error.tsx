"use client";

import { useEffect } from "react";
import { reportClientError } from "@/instrumentation-client";

/**
 * The SDK is not imported here. This file is in every page's client graph,
 * so a static import would put the SDK in the scripts every page loads
 * first. `reportClientError` hands the error to the reporter that
 * src/instrumentation-client.ts starts after the page has loaded; an error
 * caught before then is held and sent once the SDK arrives.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);
  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col items-center justify-center px-4 text-center"
    >
      <h1 className="font-display text-4xl text-[var(--ink-strong)]">
        Something went wrong
      </h1>
      <p className="mt-3 text-lg text-[var(--ink-muted)]">
        An unexpected error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        className="mt-6 inline-flex min-h-11 items-center rounded-full bg-success px-6 py-2.5 text-sm font-semibold text-on-success
                   transition hover:brightness-95"
      >
        Try again
      </button>
    </main>
  );
}
