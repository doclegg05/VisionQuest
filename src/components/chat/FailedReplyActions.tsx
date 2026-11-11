"use client";

import type { Ref } from "react";
import Link from "next/link";
import { parseSendErrorBody } from "@/lib/chat/send-outcome";

/** Where Program Setup lives (src/app/(teacher)/teacher/manage/page.tsx). */
export const PROGRAM_SETUP_HREF = "/teacher/manage";

/** The server's sentence and cause code from a refused send (rules in parseSendErrorBody). */
export async function readSendError(res: Response): Promise<Error> {
  // A body that is not JSON is the same as no body: the fixed sentence shows.
  const data: unknown = await res.json().catch(() => null);
  return parseSendErrorBody(res.status, data);
}

interface FailedReplyActionsProps {
  onRetry: () => void;
  /** Busy, slow and unknown only: a retry cannot fix off or not set up. */
  offerRetry: boolean;
  /** Admin only, when Sage is not set up. */
  setupHref: string | null;
  retryRef?: Ref<HTMLButtonElement>;
  /** The id of the failed text, so a screen reader hears why on Try again. */
  describedById?: string;
}

/** Shown once under a failed or cut-off reply. Replaced when the student retries. */
export function FailedReplyActions({ onRetry, offerRetry, setupHref, retryRef, describedById }: FailedReplyActionsProps) {
  if (!offerRetry && !setupHref) return null;
  return (
    <div className="ml-11 mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
      {offerRetry && (
        <button
          ref={retryRef}
          onClick={onRetry}
          type="button"
          aria-describedby={describedById}
          className="inline-flex min-h-11 items-center rounded-xl border border-[var(--chat-input-border)] px-4 text-sm font-semibold text-[var(--chat-sage-action)] hover:bg-[var(--chat-sage-mark-bg)]"
        >
          Try again
        </button>
      )}
      {setupHref && (
        <Link
          href={setupHref}
          prefetch={false}
          className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-semibold text-[var(--chat-sage-action)] underline underline-offset-4 hover:bg-[var(--chat-sage-mark-bg)]"
        >
          Open Program Setup
        </Link>
      )}
    </div>
  );
}
