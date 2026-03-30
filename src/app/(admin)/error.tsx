"use client";

export default function AdminError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h2 className="font-display text-2xl text-[var(--ink-strong)]">Something went wrong</h2>
      <p className="mt-3 max-w-md text-sm text-[var(--ink-muted)]">
        We hit an unexpected error. You can try again, or head back to the admin panel.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="primary-button px-5 py-2.5 text-sm"
        >
          Try again
        </button>
        <a
          href="/admin"
          className="rounded-xl border border-[rgba(18,38,63,0.15)] px-5 py-2.5 text-sm font-semibold text-[var(--ink-strong)] transition-colors hover:bg-[rgba(16,37,62,0.04)]"
        >
          Go to Admin
        </a>
      </div>
    </div>
  );
}
