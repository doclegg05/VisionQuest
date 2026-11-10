"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { StudentPasswordField, isPasswordTooShort } from "@/components/settings/StudentPasswordField";
import {
  NETWORK_VIEW,
  SIGNED_OUT_SETTINGS,
  refusalView,
  type RefusalPlace,
  type RefusalView,
} from "@/components/settings/password-change-refusal";

/**
 * The form a student changes their own password with. It posts to
 * /api/settings/password, the one write a session held to the
 * change-password screen may make.
 *
 * Two fields and no "type it again": the Show button lets the student read
 * what they typed, which a second field cannot do for someone on a phone.
 */

/** What Settings shows once the change is made. */
export const SETTINGS_SAVED_MESSAGE =
  "Your new password is saved. Use it the next time you sign in. We signed you out on any other phone or computer.";
const SETTINGS_CURRENT_LABEL = "Password you use now";

export type PasswordChangeOutcome = { ok: true } | { ok: false; refusal: RefusalView };

/** Sends the change. Never throws: every failure comes back as a place and words to show. */
export async function submitPasswordChange(
  currentPassword: string,
  newPassword: string,
  signedOutMessage: string,
): Promise<PasswordChangeOutcome> {
  try {
    const res = await fetch("/api/settings/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (res.ok) return { ok: true };
    // A refusal that is not JSON (a gateway page, say) still gets plain words.
    const body: unknown = await res.json().catch(() => null);
    return { ok: false, refusal: refusalView(res.status, body, signedOutMessage) };
  } catch {
    // fetch rejects only when the request never got an answer.
    return { ok: false, refusal: NETWORK_VIEW };
  }
}

export interface ChangePasswordFormProps {
  /** Keeps the field ids apart from any other form on the page. */
  idPrefix: string;
  /** The current field's label. Settings keeps "Password you use now". */
  currentLabel?: string;
  /** One line under the current field, tied to it. Settings has none. */
  currentHint?: string;
  /** The surface's words for a session that ended. */
  signedOutMessage?: string;
  /** The login name, so a password manager files the new password under it. */
  username?: string | null;
  /**
   * Called once the password is changed. The forced screen uses it to show
   * its confirmation; Settings leaves it out and shows a saved message.
   */
  onChanged?: () => void;
}

export type FormStatus = "idle" | "saving" | "saved" | "error";

/** The line above the button: what went wrong with the form as a whole, or that the password is saved. */
function FormMessage({ status, refusal }: { status: FormStatus; refusal: RefusalView | null }) {
  if (status === "error" && refusal?.place === "form") {
    return (
      <div role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
        <p className="flex items-start gap-2">
          <WarningCircle size={20} weight="bold" aria-hidden="true" className="shrink-0" />
          {refusal.message}
        </p>
        {refusal.signIn && (
          <Link href="/" className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-4">
            Sign in again
          </Link>
        )}
      </div>
    );
  }
  if (status === "saved") {
    return (
      <p role="status" className="rounded-2xl bg-success-soft px-4 py-3 text-sm text-success">
        {SETTINGS_SAVED_MESSAGE}
      </p>
    );
  }
  return null;
}

/** The refusal's words when it is about this field, for the field to show under itself. */
function refusalFor(refusal: RefusalView | null, place: RefusalPlace): string | undefined {
  return refusal?.place === place ? refusal.message : undefined;
}

/**
 * What the form can tell before sending: an empty current field, or a new
 * password the server would call too short. Null when it is worth sending.
 */
export function checkBeforeSending(currentPassword: string, newPassword: string, currentLabel: string): RefusalView | "too_short" | null {
  if (currentPassword.trim() === "") return { place: "current", message: `Type the ${currentLabel.toLowerCase()}.`, signIn: false };
  return isPasswordTooShort(newPassword) ? "too_short" : null;
}

interface FocusRequest {
  field: "current" | "new";
  /** A new request each time, so a second refusal on the same field moves focus again. */
  attempt: number;
}

/** The form's state and what sending it does. `ChangePasswordFormView` is the markup. */
function useChangePasswordForm(props: ChangePasswordFormProps) {
  const { currentLabel = SETTINGS_CURRENT_LABEL, signedOutMessage = SIGNED_OUT_SETTINGS, onChanged } = props;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [refusal, setRefusal] = useState<RefusalView | null>(null);
  const [sent, setSent] = useState(false);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const currentRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);

  // After the render that re-enables the fields: a disabled input takes no focus.
  useEffect(() => {
    if (focus) (focus.field === "current" ? currentRef : newRef).current?.focus();
  }, [focus]);

  function focusField(field: FocusRequest["field"]) {
    setFocus((previous) => ({ field, attempt: (previous?.attempt ?? 0) + 1 }));
  }

  function fail(next: RefusalView) {
    setStatus("error");
    setRefusal(next);
    if (next.place !== "form") focusField(next.place);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSent(true);
    const problem = checkBeforeSending(currentPassword, newPassword, currentLabel);
    if (problem === "too_short") {
      // The field names this problem itself; focus goes there to read it.
      setStatus("idle");
      setRefusal(null);
      return focusField("new");
    }
    if (problem) return fail(problem);
    setStatus("saving");
    const outcome = await submitPasswordChange(currentPassword, newPassword, signedOutMessage);
    if (!outcome.ok) return fail(outcome.refusal);
    if (onChanged) return onChanged();
    setCurrentPassword("");
    setNewPassword("");
    setSent(false);
    setRefusal(null);
    setStatus("saved");
  }

  return { currentPassword, setCurrentPassword, newPassword, setNewPassword, status, refusal, sent, handleSubmit, currentRef, newRef };
}

export interface ChangePasswordFormViewProps {
  idPrefix: string;
  currentLabel: string;
  currentHint?: string;
  username?: string | null;
  currentPassword: string;
  newPassword: string;
  onCurrentChange: (value: string) => void;
  onNewChange: (value: string) => void;
  status: FormStatus;
  refusal: RefusalView | null;
  sent: boolean;
  onSubmit: (event: React.FormEvent) => void;
  currentRef?: RefObject<HTMLInputElement | null>;
  newRef?: RefObject<HTMLInputElement | null>;
}

/** The form with its state passed in. `ChangePasswordForm` below holds the state. */
export function ChangePasswordFormView(props: ChangePasswordFormViewProps) {
  const { idPrefix, username, status, refusal } = props;
  const saving = status === "saving";
  const shown = status === "error" ? refusal : null;

  return (
    <form onSubmit={props.onSubmit} className="space-y-5" noValidate>
      {/* Not for people: it tells a password manager whose password this is. */}
      {username && <input type="text" name="username" autoComplete="username" value={username} readOnly hidden aria-label="Username" />}
      <StudentPasswordField
        id={`${idPrefix}-current`}
        label={props.currentLabel}
        hint={props.currentHint}
        value={props.currentPassword}
        onChange={props.onCurrentChange}
        autoComplete="current-password"
        refusal={refusalFor(shown, "current")}
        inputRef={props.currentRef}
        disabled={saving}
      />
      <StudentPasswordField
        id={`${idPrefix}-new`}
        label="New password"
        value={props.newPassword}
        onChange={props.onNewChange}
        autoComplete="new-password"
        showError={props.sent}
        refusal={refusalFor(shown, "new")}
        inputRef={props.newRef}
        disabled={saving}
      />
      <FormMessage status={status} refusal={refusal} />
      <button
        type="submit"
        disabled={saving}
        className="primary-button min-h-11 w-full px-6 py-3 text-base disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? "Saving..." : "Save new password"}
      </button>
    </form>
  );
}

export function ChangePasswordForm(props: ChangePasswordFormProps) {
  const form = useChangePasswordForm(props);

  return (
    <ChangePasswordFormView
      idPrefix={props.idPrefix}
      currentLabel={props.currentLabel ?? SETTINGS_CURRENT_LABEL}
      currentHint={props.currentHint}
      username={props.username}
      currentPassword={form.currentPassword}
      newPassword={form.newPassword}
      onCurrentChange={form.setCurrentPassword}
      onNewChange={form.setNewPassword}
      status={form.status}
      refusal={form.refusal}
      sent={form.sent}
      onSubmit={form.handleSubmit}
      currentRef={form.currentRef}
      newRef={form.newRef}
    />
  );
}
