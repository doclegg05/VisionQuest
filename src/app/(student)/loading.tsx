export default function StudentLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--border)]
                      border-t-[var(--accent)]"
          role="status"
          aria-label="Loading"
        />
        <p className="text-sm text-[var(--ink-muted)]">Loading&hellip;</p>
      </div>
    </div>
  );
}
