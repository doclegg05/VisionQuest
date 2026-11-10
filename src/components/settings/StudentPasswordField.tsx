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
  "field min-w-0 flex-1 px-4 py-3 text-base disabled:cursor-not-allowed disabled:opacity-70";
// The button's words carry its state, Show or Hide, so it needs one look only.
// A fixed width, so the input does not resize when the word changes.
const SHOW_BUTTON_CLASS =
  "inline-flex min-h-11 w-20 shrink-0 items-center justify-center rounded-xl border border-[var(--border-control)] bg-[var(--surface-raised)] px-4 text-sm font-semibold text-[var(--ink-strong)] disabled:cursor-not-allowed disabled:opacity-70";

/** A hint under the field. */
const LINE_CLASS = "mt-2 text-base leading-7 text-[var(--ink-muted)]";
/** An error under the field: an icon as well as color, so it reads as an error in dark too. */
const ERROR_CLASS = "mt-2 flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3 text-base leading-7 text-danger";

/** The count line under a new password, built from the same constant as the rule. */
function CountLine({ id, typed }: { id: string; typed: number }) {
  const longEnough = typed >= MIN_PASSWORD_LENGTH;
  return (
    <>
      <p id={`${id}-count`} className={`mt-1 text-base leading-7 ${longEnough ? "text-success" : "text-[var(--ink-muted)]"}`}>
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
  // The refusal first: it is the news, and the hint is the standing rule.
  const describedIds = [
    ...(refusal ? [`${id}-refusal`] : []),
    ...(isNew || hint ? [`${id}-hint`] : []),
    ...(isNew ? [`${id}-count`] : []),
    ...(tooShort ? [`${id}-error`] : []),
  ];
  const describedBy = describedIds.length > 0 ? describedIds.join(" ") : undefined;

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-[var(--ink-strong)]">
        {label}
      </label>
      <PasswordInputRow {...props} describedBy={describedBy} invalid={tooShort || Boolean(refusal)} />
      {!isNew && hint && (
        <p id={`${id}-hint`} className={LINE_CLASS}>
          {hint}
        </p>
      )}
      {isNew && (
        <>
          <p id={`${id}-hint`} className={LINE_CLASS}>
            {STUDENT_PASSWORD_HINT}
          </p>
          <CountLine id={id} typed={typedPasswordLength(value)} />
        </>
      )}
      {tooShort && (
        // After sending, focus moves to this field, which describes the error,
        // so an alert would read it twice. Shown on leaving the field, nothing
        // moves focus, so it is an alert then.
        <p id={`${id}-error`} role={showError ? undefined : "alert"} className={ERROR_CLASS}>
          <WarningCircle size={20} weight="bold" aria-hidden="true" className="shrink-0" />
          {STUDENT_PASSWORD_TOO_SHORT_MESSAGE}
        </p>
      )}
      {refusal && (
        <p id={`${id}-refusal`} className={ERROR_CLASS}>
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
