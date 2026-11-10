"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SAGE_NOTICE_SIGN_OUT_BUTTON, SAGE_NOTICE_SIGN_OUT_LINE } from "@/lib/about-sage/notice";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Ends the session, then leaves whatever the server said. The same handling
 * as the sign-out button on the change-password screen
 * (src/components/settings/ChangePasswordScreen.tsx), which keeps its copy
 * private.
 */
export async function signOutThen(fetchImpl: FetchLike, onSignedOut: () => void): Promise<void> {
  try {
    await fetchImpl("/api/auth/session", { method: "DELETE" });
  } finally {
    onSignedOut();
  }
}

/** The way off the held screen for a student who is not ready to agree. */
export function SignOutBlock() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await signOutThen(fetch, () => {
      // replace() so Back does not return here; refresh drops this session's render.
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <div className="mt-6 border-t border-[var(--border)] pt-4">
      <p className="text-sm leading-6 text-[var(--ink-muted)]">{SAGE_NOTICE_SIGN_OUT_LINE}</p>
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="mt-1 inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-semibold text-[var(--ink-strong)] underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {SAGE_NOTICE_SIGN_OUT_BUTTON}
      </button>
    </div>
  );
}
