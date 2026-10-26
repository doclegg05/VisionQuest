import { DEMO_PRIVACY_NOTICE } from "@/lib/demo/copy";

/**
 * The warning a demo student sees: the instructor side can read what they
 * type. It always renders when asked. Whether to ask is the caller's job, since
 * the welcome page knows from the server session and ChatInput knows from
 * `useDemoAccount()`.
 */
export function DemoPrivacyNotice() {
  return (
    <p role="note" className="text-sm leading-5 text-[var(--ink-muted)]">
      {DEMO_PRIVACY_NOTICE}
    </p>
  );
}
