import Link from "next/link";

interface ChatErrorBannerProps {
  message: string;
}

function isApiKeyIssue(message: string): boolean {
  return message.includes("API key") || message.includes("Sage is not configured");
}

/**
 * Hard-error banner shown under the chat transcript when a send attempt
 * fails outright. Sage is this app's designed help channel, so when Sage
 * itself is the thing that broke, the banner can't be a dead end — every
 * render carries a second path out: the Help page, and a reminder that a
 * teacher is always a valid fallback.
 */
export function ChatErrorBanner({ message }: ChatErrorBannerProps) {
  const apiKeyIssue = isApiKeyIssue(message);

  return (
    <div
      role="alert"
      className="mx-4 mb-2 rounded-xl border border-[var(--chat-error-border)] bg-[var(--chat-error-bg)] px-4 py-3 text-sm text-[var(--chat-error-text)]"
    >
      <p>{message}</p>
      {apiKeyIssue && (
        <Link
          href="/settings"
          prefetch={false}
          className="mt-2 inline-block font-semibold text-[var(--chat-sage-action)] hover:text-[var(--ink-strong)]"
        >
          Open Settings →
        </Link>
      )}
      <p className="mt-2 text-xs">
        Need more help?{" "}
        <Link
          href="/help"
          prefetch={false}
          className="font-semibold text-[var(--chat-sage-action)] hover:text-[var(--ink-strong)]"
        >
          Visit the Help page
        </Link>{" "}
        or ask your teacher.
      </p>
    </div>
  );
}
