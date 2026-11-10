"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";

import type { Notice } from "@/lib/teacher/student-action";

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

/**
 * The one message an action leaves on the instructor's student page, pinned
 * to the bottom of the viewport so it shows wherever the instructor is on a
 * long tab. The page does not scroll to it.
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
    <div className="fixed inset-x-4 bottom-4 z-50 rounded-xl bg-[var(--surface-raised)] shadow-lg sm:left-auto sm:right-6 sm:max-w-md">
      <div role={look.role} className={`flex items-start gap-3 rounded-xl border-2 p-3 text-sm text-[var(--ink-strong)] ${look.tone}`}>
        {look.icon}
        <p className="flex-1 self-center">
          {notice.kind === "error" ? <strong className="font-semibold">Not saved: </strong> : null}
          {notice.text}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-sm font-semibold text-[var(--ink-strong)] hover:bg-[var(--surface-interactive)]"
        >
          <X size={16} aria-hidden="true" />
          Dismiss
        </button>
      </div>
    </div>
  );
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
