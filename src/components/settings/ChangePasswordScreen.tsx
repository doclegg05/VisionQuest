"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";

/** Ends the session and leaves for the sign-in page, the one place this session can still go. */
function SignOutButton({ onSignedOut }: { onSignedOut: () => void }) {
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
    } finally {
      // Whatever the server said, leave.
      onSignedOut();
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={signingOut}
      className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-semibold text-[var(--ink-strong)] underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      Sign out
    </button>
  );
}

/**
 * What a student sees when they must choose a new password before anything
 * else: staff set the one they signed in with, so a staff member knows it.
 * src/proxy.ts sends every other page here until the change is made.
 *
 * The only ways off this screen are to change the password or to sign out.
 * There is no link into the app: the proxy would only send it back.
 */
export function ChangePasswordScreen() {
  const router = useRouter();

  /** The session cookie is new or gone: leave, and drop whatever was rendered for the old one. */
  function leaveFor(path: string) {
    // replace() so Back does not return here.
    router.replace(path);
    router.refresh();
  }

  return (
    <div className="surface-section p-6 sm:p-8">
      <p className="page-eyebrow text-[var(--ink-muted)]">One quick step</p>
      <h1 className="mt-1 font-display text-2xl text-[var(--ink-strong)]">Choose a New Password</h1>
      <p className="mt-2 text-base leading-7 text-[var(--ink-strong)]">
        Your instructor set this password. Choose a new one that only you know.
      </p>
      <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
        When you save it, we sign you out on any other phone or computer.
      </p>

      <div className="mt-6">
        <ChangePasswordForm idPrefix="change-password" onChanged={() => leaveFor("/dashboard")} />
      </div>

      <div className="mt-6 border-t border-[var(--border)] pt-4">
        <SignOutButton onSignedOut={() => leaveFor("/")} />
      </div>
    </div>
  );
}
