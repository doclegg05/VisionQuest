"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import {
  SAGE_NOTICE_SIGN_OUT_BUTTON,
  SAGE_NOTICE_SIGN_OUT_FAILED,
  SAGE_NOTICE_SIGN_OUT_LINE,
} from "@/lib/about-sage/notice";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Ends the session and leaves only when the server says it ended. A failed
 * or unanswered request leaves the cookie good, and on a shared classroom
 * computer leaving for the sign-in page would hand the next person this
 * student's account. A 401 proves nothing: DELETE /api/auth/session never
 * answers 401 itself, so one came from something in between. The same rule
 * as the change-password screen's requestSignOut. Never throws.
 */
export async function signOutThen(fetchImpl: FetchLike, onSignedOut: () => void): Promise<boolean> {
  let ended = false;
  try {
    const res = await fetchImpl("/api/auth/session", { method: "DELETE" });
    ended = res.ok;
  } catch {
    // No answer: the session may still be live, so stay and say so.
    ended = false;
  }
  if (ended) onSignedOut();
  return ended;
}

/** The way off the held screen for a student who is not ready to agree. */
export function SignOutBlock() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setSigningOut(true);
    setFailed(false);
    const left = await signOutThen(fetch, () => {
      // replace() so Back does not return here; refresh drops this session's render.
      router.replace("/");
      router.refresh();
    });
    if (left) return;
    setSigningOut(false);
    setFailed(true);
  }

  return (
    <div className="mt-6 border-t border-[var(--border)] pt-4">
      <p className="text-sm leading-6 text-[var(--ink-muted)]">{SAGE_NOTICE_SIGN_OUT_LINE}</p>
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="mt-1 inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-semibold text-[var(--ink-strong)] underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {SAGE_NOTICE_SIGN_OUT_BUTTON}
      </button>
      {failed && (
        <p role="alert" className="mt-2 flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          <WarningCircle size={20} weight="bold" aria-hidden="true" className="shrink-0" />
          {SAGE_NOTICE_SIGN_OUT_FAILED}
        </p>
      )}
    </div>
  );
}
