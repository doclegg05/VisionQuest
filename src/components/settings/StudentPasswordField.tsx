"use client";

import { useState, type Ref } from "react";
import {
  MIN_PASSWORD_LENGTH,
  STUDENT_PASSWORD_HINT,
  STUDENT_PASSWORD_TOO_SHORT_MESSAGE,
} from "@/lib/password-policy";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";

/**
 * The one password field students use: on the change-password screen, in
 * Settings, and on both recovery pages.
 *
 * A new password shows its rule under the field at all times, counts what has
 * been typed against the number the rule is built from, and names the problem
 * when it is too short. Every password can be looked at with the Show button,
 * which says Hide while it is on.
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
  /** One line under the field that says how to type it, tied by aria-describedby. */
  hint?: string;
  /** The server's refusal about this field. It marks the field invalid and is tied to it. */
  refusal?: string;
  /** Lets the form move focus here when this field holds the problem. */
  inputRef?: Ref<HTMLInputElement>;
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
// The button's words carry its state, Show or Hide, so it needs one look only.
const SHOW_BUTTON_CLASS =
  "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border-control)] bg-[var(--surface-raised)] px-4 text-sm font-semibold text-[var(--ink-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-70";

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
  inputRef,
  describedBy,
  invalid,
}: PasswordInputRowProps) {
  const action = revealed ? "Hide" : "Show";
  return (
    <div className="flex items-stretch gap-2">
      <input
        ref={inputRef}
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
        aria-controls={id}
        aria-label={`${action} ${label.toLowerCase()}`}
        className={SHOW_BUTTON_CLASS}
      >
        {action}
      </button>
    </div>
  );
}

/** The field with its state passed in. `StudentPasswordField` below holds the state. */
export function StudentPasswordFieldView(props: StudentPasswordFieldViewProps) {
  const { id, label, value, autoComplete, showError = false, touched, hint, refusal } = props;
  const isNew = autoComplete === "new-password";
  // An empty field the student only passed through is not an error yet.
  const tooShort = isNew && isPasswordTooShort(value) && (showError || (touched && value !== ""));
  const describedIds = [
    ...(isNew || hint ? [`${id}-hint`] : []),
    ...(isNew ? [`${id}-count`] : []),
    ...(tooShort ? [`${id}-error`] : []),
    ...(refusal ? [`${id}-refusal`] : []),
  ];
  const describedBy = describedIds.length > 0 ? describedIds.join(" ") : undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
        {label}
      </label>
      <PasswordInputRow {...props} describedBy={describedBy} invalid={tooShort || Boolean(refusal)} />
      {!isNew && hint && (
        <p id={`${id}-hint`} className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
          {hint}
        </p>
      )}
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
      {refusal && (
        <p id={`${id}-refusal`} className="mt-2 flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          <WarningCircle size={20} weight="bold" aria-hidden="true" className="shrink-0" />
          {refusal}
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
