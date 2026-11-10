"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";

import { leadSentence, type Notice } from "@/lib/teacher/student-action";

/** A success line goes away on its own after this long. A failure stays until dismissed. */
export const SUCCESS_CLEARS_AFTER_MS = 6000;

interface ActionNoticeProps {
  notice: Notice | null;
  onDismiss: () => void;
}

const LOOK = {
  error: {
    role: "alert",
    tone: "border-danger bg-danger-soft",
    icon: <WarningCircle size={22} weight="fill" aria-hidden="true" className="shrink-0 text-danger" />,
  },
  success: {
    role: "status",
    tone: "border-success bg-success-soft",
    icon: <CheckCircle size={22} weight="fill" aria-hidden="true" className="shrink-0 text-success" />,
  },
} as const;

/** A failure says what did not happen, then why. The first sentence is the one to read, so it is bold. */
function NoticeText({ notice }: { notice: Notice }) {
  if (notice.kind !== "error") return <>{notice.text}</>;
  const { lead, rest } = leadSentence(notice.text);
  return (
    <>
      <strong className="font-semibold">{lead}</strong>
      {rest ? ` ${rest}` : null}
    </>
  );
}

/**
 * The one message an action leaves on the instructor's student page, pinned
 * to the bottom of the viewport so it shows wherever the instructor is on a
 * long tab. The page does not scroll to it.
 *
 * It sits at the height the undo toast uses (`UndoToastView` in
 * `src/components/ui/useUndo.tsx`), which is above the phone tab bar. On
 * desktop it is centred in the content area: `md:left-[19rem]` is where the
 * staff layout starts its content, so the sidebar is not covered, and
 * `md:right-24` keeps it off the Sage button in the corner. The spacer is in
 * the page flow, so the last button can be scrolled out from under it. Its
 * height covers a failure that wraps to seven lines on a 320px phone.
 */
export function ActionNotice({ notice, onDismiss }: ActionNoticeProps) {
  useEffect(() => {
    if (!notice || notice.kind !== "success") return;
    const timer = setTimeout(onDismiss, SUCCESS_CLEARS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);

  if (!notice) return null;
  const look = LOOK[notice.kind];
  return (
    <>
      <div aria-hidden="true" className="h-48 md:h-36" />
      <div className="pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] z-50 flex justify-center md:left-[19rem] md:right-24 md:bottom-6">
        <div className="pointer-events-auto w-full max-w-md rounded-xl bg-[var(--surface-raised)] shadow-lg">
          <div role={look.role} className={`flex items-start gap-3 rounded-xl border-2 p-3 text-sm text-[var(--ink-strong)] ${look.tone}`}>
            {look.icon}
            <p className="flex-1 self-center">
              <NoticeText notice={notice} />
            </p>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss message"
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-sm font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-interactive)]"
            >
              <X size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Dismiss</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * True when the tab now on screen is not the one shown before it. The first
 * tab is not a change. Neither is the same tab put back: the page takes its
 * tabs down while a failed reload shows, and a failure must outlive that.
 */
export function isTabChange(previous: string | null, shown: string): boolean {
  return previous !== null && previous !== shown;
}

interface ShownTabProps {
  onShown: () => void;
  children: ReactNode;
}

/**
 * Calls `onShown` once when its tab is put on screen. Give each tab its own
 * `key` so a tab change mounts a new one. The callback is read through a ref,
 * so a new function on every render does not call it again.
 */
export function ShownTab({ onShown, children }: ShownTabProps) {
  const latest = useRef(onShown);
  useEffect(() => {
    latest.current = onShown;
  });
  useEffect(() => {
    latest.current();
  }, []);
  return <>{children}</>;
}
