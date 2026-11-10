"use client";

import { useState } from "react";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { StudentPasswordField, isPasswordTooShort } from "@/components/settings/StudentPasswordField";

/**
 * The form a student changes their own password with. It posts to
 * /api/settings/password, the one write a session held to the
 * change-password screen may make.
 *
 * Two fields and no "type it again": the Show button lets the student read
 * what they typed, which a second field cannot do for someone on a phone.
 */

const MISSING_CURRENT_PASSWORD = "Type the password you use now.";
const FALLBACK_ERROR = "We could not change your password. Please try again.";
const NETWORK_ERROR = "We could not reach the server. Please try again.";
const SAVED_MESSAGE = "Your new password is saved. Use it the next time you sign in.";

/** The words to show for a refused change: the server's when it sent some, ours otherwise. */
export function changeFailureMessage(body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" && body.error) {
    return body.error;
  }
  return FALLBACK_ERROR;
}

export type PasswordChangeOutcome = { ok: true } | { ok: false; message: string };

/** Sends the change. Never throws: every failure comes back as words to show. */
export async function submitPasswordChange(currentPassword: string, newPassword: string): Promise<PasswordChangeOutcome> {
  try {
    const res = await fetch("/api/settings/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (res.ok) return { ok: true };
    // A refusal that is not JSON (a gateway page, say) still gets plain words.
    const body: unknown = await res.json().catch(() => null);
    return { ok: false, message: changeFailureMessage(body) };
  } catch {
    // fetch rejects only when the request never got an answer.
    return { ok: false, message: NETWORK_ERROR };
  }
}

export interface ChangePasswordFormProps {
  /** Keeps the two field ids apart from any other form on the page. */
  idPrefix: string;
  /**
   * Called once the password is changed. The forced screen uses it to move
   * on to the app; Settings leaves it out and shows a saved message in place.
   */
  onChanged?: () => void;
}

type FormStatus = "idle" | "saving" | "saved" | "error";

/** The line under the fields: what went wrong, or that the new password is saved. */
function FormMessage({ status, error }: { status: FormStatus; error: string }) {
  if (status === "error") {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
        <WarningCircle size={20} weight="bold" aria-hidden="true" className="shrink-0" />
        {error}
      </p>
    );
  }
  if (status === "saved") {
    return (
      <p role="status" className="rounded-2xl bg-success-soft px-4 py-3 text-sm text-success">
        {SAVED_MESSAGE}
      </p>
    );
  }
  return null;
}

/** The form's state and what sending it does. The component below is the markup. */
function useChangePasswordForm(onChanged: (() => void) | undefined) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  function fail(message: string) {
    setStatus("error");
    setError(message);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSent(true);
    if (currentPassword.trim() === "") return fail(MISSING_CURRENT_PASSWORD);
    // The field names this problem itself; there is nothing to send yet.
    if (isPasswordTooShort(newPassword)) return setStatus("idle");

    setStatus("saving");
    const outcome = await submitPasswordChange(currentPassword, newPassword);
    if (!outcome.ok) return fail(outcome.message);
    if (onChanged) return onChanged();
    setCurrentPassword("");
    setNewPassword("");
    setSent(false);
    setStatus("saved");
  }

  return { currentPassword, setCurrentPassword, newPassword, setNewPassword, status, error, sent, handleSubmit };
}

export function ChangePasswordForm({ idPrefix, onChanged }: ChangePasswordFormProps) {
  const form = useChangePasswordForm(onChanged);
  const saving = form.status === "saving";

  return (
    <form onSubmit={form.handleSubmit} className="space-y-5" noValidate>
      <StudentPasswordField
        id={`${idPrefix}-current`}
        label="Password you use now"
        value={form.currentPassword}
        onChange={form.setCurrentPassword}
        autoComplete="current-password"
        disabled={saving}
      />
      <StudentPasswordField
        id={`${idPrefix}-new`}
        label="New password"
        value={form.newPassword}
        onChange={form.setNewPassword}
        autoComplete="new-password"
        showError={form.sent}
        disabled={saving}
      />
      <FormMessage status={form.status} error={form.error} />
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
