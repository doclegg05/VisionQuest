"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { SIGNED_OUT_FORCED } from "@/components/settings/password-change-refusal";

/** The current field on this screen: the password the instructor read out. */
export const FORCED_CURRENT_LABEL = "Password your instructor gave you";
/**
 * The generated password has dashes, and a student may leave them out.
 * "just as", not "just like": the hint guard reads the run after "like" as an
 * example password (password-hint-safety.test.tsx).
 */
export const FORCED_CURRENT_HINT = "Type it just as your instructor gave it, with the dashes.";
/** Shown above the Save button and again once saved, when the browser offers to save it. */
export const SHARED_COMPUTER_TIP = "Is this a shared computer? If it asks to save your password, tap Never or Not now.";

const BUTTON_CLASS =
  "inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-semibold text-[var(--ink-strong)] underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Ends the session. True only when the server answers that it ended it.
 * DELETE /api/auth/session never answers 401 itself, so a 401 came from
 * something in between and proves nothing. Never throws: a dropped
 * connection is a false.
 */
export async function requestSignOut(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/session", { method: "DELETE" });
    return res.ok;
  } catch {
    // The request never got an answer; the session may still be live.
    return false;
  }
}

interface SignOutButtonViewProps {
  signingOut: boolean;
  failed: boolean;
  onSignOut: () => void;
}

export function SignOutButtonView({ signingOut, failed, onSignOut }: SignOutButtonViewProps) {
  return (
    <div>
      <p className="text-sm leading-6 text-[var(--ink-muted)]">Not ready? Sign out and do this later.</p>
      <button type="button" onClick={onSignOut} disabled={signingOut} className={BUTTON_CLASS}>
        Sign out
      </button>
      {failed && (
        <p role="alert" className="mt-2 flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          <WarningCircle size={20} weight="bold" aria-hidden="true" className="shrink-0" />
          Could not sign out. Try again.
        </p>
      )}
    </div>
  );
}

/** Ends the session and leaves for the sign-in page, or says it could not and stays. */
function SignOutButton({ onSignedOut }: { onSignedOut: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setSigningOut(true);
    setFailed(false);
    const signedOut = await requestSignOut();
    if (signedOut) return onSignedOut();
    setSigningOut(false);
    setFailed(true);
  }

  return <SignOutButtonView signingOut={signingOut} failed={failed} onSignOut={signOut} />;
}

/**
 * What replaces the form once the password is saved. The box takes focus, so
 * the news is read out first; a status role would read it a second time.
 * Continue sits outside the box, so focus reads the news and not the button.
 */
export function PasswordSavedConfirmation({ onContinue }: { onContinue: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => boxRef.current?.focus(), []);

  return (
    <div>
      {/* Keeps its own ring: focus arrives by script after a tap on Save, which
          does not match the app's :focus-visible rule, so that rule draws none. */}
      <div ref={boxRef} tabIndex={-1} className="rounded-2xl bg-success-soft px-4 py-4 focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]">
        <p className="text-base leading-7 text-success">Your new password is saved. You will use it the next time you sign in.</p>
        <p className="mt-2 text-sm leading-6 text-success">{SHARED_COMPUTER_TIP}</p>
      </div>
      <button type="button" onClick={onContinue} className="primary-button mt-4 min-h-11 w-full px-6 py-3 text-base">
        Continue
      </button>
    </div>
  );
}

/** The form as this screen asks for it: the instructor's password, then a new one. */
function ForcedChangeForm({ username, onChanged }: { username: string; onChanged: () => void }) {
  return (
    <ChangePasswordForm
      idPrefix="change-password"
      currentLabel={FORCED_CURRENT_LABEL}
      currentHint={FORCED_CURRENT_HINT}
      signedOutMessage={SIGNED_OUT_FORCED}
      username={username}
      tip={SHARED_COMPUTER_TIP}
      onChanged={onChanged}
    />
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
export function ChangePasswordScreen({ username }: { username: string }) {
  const router = useRouter();
  const [changed, setChanged] = useState(false);

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
        Your instructor set the password you just used. Choose a new one that only you know. This is a normal first step.
      </p>

      <div className="mt-6">
        {changed ? (
          <PasswordSavedConfirmation onContinue={() => leaveFor("/dashboard")} />
        ) : (
          <ForcedChangeForm username={username} onChanged={() => setChanged(true)} />
        )}
      </div>

      {!changed && (
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <SignOutButton onSignedOut={() => leaveFor("/")} />
        </div>
      )}
    </div>
  );
}
