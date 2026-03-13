"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col items-center justify-center px-4 text-center"
    >
      <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold text-[var(--ink-strong)]">
        Something went wrong
      </h1>
      <p className="mt-3 text-lg text-[var(--muted)]">
        An unexpected error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white
                   transition hover:bg-[var(--accent-strong)]"
      >
        Try again
      </button>
    </main>
  );
}
