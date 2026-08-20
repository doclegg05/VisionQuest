"use client";

interface RetryResponseButtonProps {
  onRetry: () => void;
}

/**
 * "Retry response" control shared by every failed-assistant-message path:
 * the partial-content path that already had it, and the zero-content path
 * (a thrown send error, or an SSE stream that finished with nothing to
 * show) that used to render no way back in at all.
 */
export function RetryResponseButton({ onRetry }: RetryResponseButtonProps) {
  return (
    <button
      onClick={onRetry}
      type="button"
      className="ml-11 mt-2 text-xs font-semibold text-[var(--chat-sage-action)] hover:text-[var(--ink-strong)]"
    >
      Retry response
    </button>
  );
}
