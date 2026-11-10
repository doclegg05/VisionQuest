"use client";

import { useState } from "react";
import {
  MIN_PASSWORD_LENGTH,
  STUDENT_PASSWORD_HINT,
  STUDENT_PASSWORD_TOO_SHORT_MESSAGE,
} from "@/lib/password-policy";

/**
 * The one password field students use: on the change-password screen, in
 * Settings, and on both recovery pages.
 *
 * A new password shows its rule under the field at all times, counts what has
 * been typed against the number the rule is built from, and names the problem
 * when it is too short. Every password can be looked at with the Show button.
 * It is a password input, so a browser can offer to save it; only Show turns
 * it into text.
 */

/** How many characters the server will count: it trims first, as sign-in does. */
export function typedPasswordLength(value: string): number {
  return value.trim().length;
}

/** Whether the server would refuse this new password as too short. */
export function isPasswordTooShort(value: string): boolean {
  return typedPasswordLength(value) < MIN_PASSWORD_LENGTH;
}

export interface StudentPasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * `new-password` shows the length rule, the count and the too-short error.
   * `current-password` shows the field and the Show button only: the server
   * checks that one against what is stored, not against a length.
   */
  autoComplete: "new-password" | "current-password";
  /** True once the form was sent, so a short password is named even if the field was never left. */
  showError?: boolean;
  disabled?: boolean;
}

export interface StudentPasswordFieldViewProps extends StudentPasswordFieldProps {
  /** Whether the password is shown as text. */
  revealed: boolean;
  onToggleReveal: () => void;
  /** Whether the student has left the field at least once. */
  touched: boolean;
  onBlur: () => void;
}

const INPUT_CLASS =
  "field min-w-0 flex-1 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-70";
const SHOW_BUTTON_BASE =
  "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border px-4 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-70";
const SHOW_BUTTON_OFF = "border-[var(--border-control)] bg-[var(--surface-raised)] text-[var(--ink-strong)]";
const SHOW_BUTTON_ON = "border-[var(--ink-strong)] bg-[var(--surface-muted)] text-[var(--ink-strong)]";

/** The count line under a new password, built from the same constant as the rule. */
function CountLine({ id, typed }: { id: string; typed: number }) {
  const longEnough = typed >= MIN_PASSWORD_LENGTH;
  return (
    <>
      <p id={`${id}-count`} className={`mt-1 text-sm ${longEnough ? "text-success" : "text-[var(--ink-muted)]"}`}>
        You have typed {typed}. {longEnough ? "That is long enough." : `You need ${MIN_PASSWORD_LENGTH} or more.`}
      </p>
      {/* Read out once, when the password crosses the line, and not on every key. */}
      <span className="sr-only" aria-live="polite">
        {longEnough ? "Your password is long enough." : ""}
      </span>
    </>
  );
}

interface PasswordInputRowProps extends StudentPasswordFieldViewProps {
  describedBy: string | undefined;
  invalid: boolean;
}

/** The input and the Show button beside it. */
function PasswordInputRow({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled = false,
  revealed,
  onToggleReveal,
  onBlur,
  describedBy,
  invalid,
}: PasswordInputRowProps) {
  return (
    <div className="flex items-stretch gap-2">
      <input
        id={id}
        type={revealed ? "text" : "password"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        required
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        className={INPUT_CLASS}
      />
      <button
        type="button"
        onClick={onToggleReveal}
        disabled={disabled}
        aria-pressed={revealed}
        aria-controls={id}
        aria-label={`Show ${label.toLowerCase()}`}
        className={`${SHOW_BUTTON_BASE} ${revealed ? SHOW_BUTTON_ON : SHOW_BUTTON_OFF}`}
      >
        Show
      </button>
    </div>
  );
}

/** The field with its state passed in. `StudentPasswordField` below holds the state. */
export function StudentPasswordFieldView(props: StudentPasswordFieldViewProps) {
  const { id, label, value, autoComplete, showError = false, touched } = props;
  const isNew = autoComplete === "new-password";
  // An empty field the student only passed through is not an error yet.
  const tooShort = isNew && isPasswordTooShort(value) && (showError || (touched && value !== ""));
  const describedBy = isNew
    ? [`${id}-hint`, `${id}-count`, ...(tooShort ? [`${id}-error`] : [])].join(" ")
    : undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
        {label}
      </label>
      <PasswordInputRow {...props} describedBy={describedBy} invalid={tooShort} />
      {isNew && (
        <>
          <p id={`${id}-hint`} className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            {STUDENT_PASSWORD_HINT}
          </p>
          <CountLine id={id} typed={typedPasswordLength(value)} />
        </>
      )}
      {tooShort && (
        <p id={`${id}-error`} role="alert" className="mt-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {STUDENT_PASSWORD_TOO_SHORT_MESSAGE}
        </p>
      )}
    </div>
  );
}

export function StudentPasswordField(props: StudentPasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const [touched, setTouched] = useState(false);

  return (
    <StudentPasswordFieldView
      {...props}
      revealed={revealed}
      onToggleReveal={() => setRevealed((current) => !current)}
      touched={touched}
      onBlur={() => setTouched(true)}
    />
  );
}
