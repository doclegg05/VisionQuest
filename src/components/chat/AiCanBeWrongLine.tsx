import {
  SAGE_CHAT_AI_LINE,
  SAGE_CHAT_NOTICE_LINK,
  SAGE_CHAT_NOTICE_NEW_TAB,
  SAGE_NOTICE_PATH,
} from "@/lib/about-sage/notice";

interface AiCanBeWrongLineProps {
  /** Link to the notice. Only the small chat, for students: the full chat has "About Sage" in its header. */
  showLink?: boolean;
}

/**
 * Under the message box for every chat role (E6): Sage is an AI and can be
 * wrong. Plain text, never a live region, so a screen reader does not repeat
 * it after each reply. It comes after the box in the page, so the link sits
 * after the box in tab order. The link opens a new tab so the typed message
 * and a reply still streaming survive; its padding gives a 44px target
 * without making the row taller.
 */
export function AiCanBeWrongLine({ showLink = false }: AiCanBeWrongLineProps) {
  return (
    <p className="mt-1 flex flex-wrap items-center justify-center gap-x-1 px-1 text-center text-xs text-[var(--ink-muted)]">
      <span>{SAGE_CHAT_AI_LINE}</span>
      {showLink && (
        <a
          href={SAGE_NOTICE_PATH}
          target="_blank"
          rel="noopener noreferrer"
          className="-my-3 inline-flex items-center px-1 py-3 font-semibold underline hover:text-[var(--ink-strong)]"
        >
          {`${SAGE_CHAT_NOTICE_LINK} ${SAGE_CHAT_NOTICE_NEW_TAB}`}
        </a>
      )}
    </p>
  );
}
