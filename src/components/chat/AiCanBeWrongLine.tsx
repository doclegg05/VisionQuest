import Link from "next/link";
import { SAGE_CHAT_AI_LINE, SAGE_CHAT_NOTICE_LINK, SAGE_NOTICE_PATH } from "@/lib/about-sage/notice";

/**
 * Under the message box for every chat role (E6): Sage is an AI and can be
 * wrong, with a link to the full notice. Plain text, never a live region, so
 * a screen reader does not repeat it after each reply. It comes after the box
 * in the page, so the link sits after the box in tab order.
 */
export function AiCanBeWrongLine() {
  return (
    <p className="mt-1 flex flex-wrap items-center justify-center gap-x-1 px-1 text-center text-xs text-[var(--ink-muted)]">
      <span>{SAGE_CHAT_AI_LINE}</span>
      <Link
        href={SAGE_NOTICE_PATH}
        className="inline-flex min-h-11 items-center px-1 font-semibold underline hover:text-[var(--ink-strong)]"
      >
        {SAGE_CHAT_NOTICE_LINK}
      </Link>
    </p>
  );
}
