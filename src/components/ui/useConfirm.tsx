"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. Defaults to true. */
  destructive?: boolean;
}

export interface AlertOptions {
  title: string;
  message?: string;
  /** Acknowledge button label. Defaults to "OK". */
  okLabel?: string;
}

export interface PromptOptions {
  title: string;
  message?: string;
  /** Visible label for the text area. */
  label: string;
  placeholder?: string;
  /** The verb for what happens, e.g. "Return form". HIG alerts: avoid "OK" unless purely informational. */
  confirmLabel: string;
  cancelLabel?: string;
  maxLength?: number;
}

export interface DialogInput {
  label: string;
  placeholder?: string;
  maxLength?: number;
}

export interface DialogState {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string | null; // null => alert mode (single button)
  destructive: boolean;
  input?: DialogInput; // present => prompt mode
}

type Resolver = (confirmed: boolean, text: string) => void;

/** What prompt() resolves to: null when cancelled, otherwise the trimmed text. */
export function promptResult(confirmed: boolean, text: string): string | null {
  return confirmed ? text.trim() : null;
}

const BUTTON = "inline-flex min-h-11 w-full items-center justify-center rounded-full px-5 py-2 text-sm font-semibold transition-colors sm:w-auto";

interface ConfirmDialogBodyProps {
  state: DialogState;
  titleId: string;
  messageId: string;
  inputId: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSettle: (confirmed: boolean) => void;
}

/** The dialog's contents. Exported so the markup can be tested without a DOM. */
export function ConfirmDialogBody({
  state,
  titleId,
  messageId,
  inputId,
  inputValue,
  onInputChange,
  onSettle,
}: ConfirmDialogBodyProps) {
  return (
    <div className="p-6">
      <h2 id={titleId} className="font-display text-lg text-[var(--ink-strong)]">
        {state.title}
      </h2>
      {state.message && (
        <p id={messageId} className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
          {state.message}
        </p>
      )}
      {state.input && (
        <div className="mt-4 space-y-1.5">
          <label htmlFor={inputId} className="block text-sm font-medium text-[var(--ink-strong)]">
            {state.input.label}
          </label>
          <textarea
            id={inputId}
            rows={3}
            value={inputValue}
            maxLength={state.input.maxLength}
            placeholder={state.input.placeholder}
            onChange={(e) => onInputChange(e.target.value)}
            className="field w-full px-3 py-2 text-base"
          />
        </div>
      )}
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {state.cancelLabel !== null && (
          <button
            type="button"
            onClick={() => onSettle(false)}
            className={`${BUTTON} border border-[var(--border)] text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]`}
          >
            {state.cancelLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => onSettle(true)}
          className={
            state.destructive
              ? `${BUTTON} bg-[var(--error)] text-[var(--on-error)] hover:brightness-95`
              : `${BUTTON} primary-button`
          }
        >
          {state.confirmLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Accessible, promise-based replacement for native window.confirm()/alert()/prompt().
 *
 * Built on the <dialog> element so destructive confirmations are keyboard- and
 * screen-reader-operable (focus trap, Escape to cancel, role="alertdialog") for
 * our WCAG-AA, low-literacy audience.
 *
 * Usage:
 *   const { confirm, alert, prompt, confirmDialog } = useConfirm();
 *   if (await confirm({ title: "Delete file?", confirmLabel: "Delete" })) { ... }
 *   await alert({ title: "Could not delete. Please try again." });
 *   const note = await prompt({ title: "Return form?", label: "Note (optional)" }); // null if cancelled
 *   return (<>{...}{confirmDialog}</>);
 */
export function useConfirm() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolverRef = useRef<Resolver | null>(null);
  const [state, setState] = useState<DialogState | null>(null);
  const [inputValue, setInputValue] = useState("");
  const titleId = useId();
  const messageId = useId();
  const inputId = useId();

  const settle = useCallback(
    (confirmed: boolean) => {
      const resolve = resolverRef.current;
      resolverRef.current = null;
      if (dialogRef.current?.open) dialogRef.current.close();
      setState(null);
      setInputValue("");
      resolve?.(confirmed, inputValue);
    },
    [inputValue],
  );

  const open = useCallback((next: DialogState, resolver: Resolver) => {
    // A newer request replaces the dialog; settle the older one as cancelled
    // rather than leaving its caller awaiting forever.
    resolverRef.current?.(false, "");
    setInputValue("");
    setState(next);
    resolverRef.current = resolver;
  }, []);

  // Unmounting with a dialog open (a route change, a closed parent) cancels it.
  useEffect(
    () => () => {
      resolverRef.current?.(false, "");
      resolverRef.current = null;
    },
    [],
  );

  const confirm = useCallback(
    (opts: ConfirmOptions): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        open(
          {
            title: opts.title,
            message: opts.message,
            confirmLabel: opts.confirmLabel ?? "Confirm",
            cancelLabel: opts.cancelLabel ?? "Cancel",
            destructive: opts.destructive ?? true,
          },
          (confirmed) => resolve(confirmed),
        );
      }),
    [open],
  );

  const alert = useCallback(
    (opts: AlertOptions): Promise<void> =>
      new Promise<void>((resolve) => {
        open(
          {
            title: opts.title,
            message: opts.message,
            confirmLabel: opts.okLabel ?? "OK",
            cancelLabel: null,
            destructive: false,
          },
          () => resolve(),
        );
      }),
    [open],
  );

  const prompt = useCallback(
    (opts: PromptOptions): Promise<string | null> =>
      new Promise<string | null>((resolve) => {
        open(
          {
            title: opts.title,
            message: opts.message,
            confirmLabel: opts.confirmLabel,
            cancelLabel: opts.cancelLabel ?? "Cancel",
            destructive: false,
            input: { label: opts.label, placeholder: opts.placeholder, maxLength: opts.maxLength },
          },
          (confirmed, text) => resolve(promptResult(confirmed, text)),
        );
      }),
    [open],
  );

  // Show modally once a request is queued. showModal() moves focus into the
  // dialog and makes the rest of the page inert.
  useEffect(() => {
    if (state && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [state]);

  const confirmDialog = (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={state?.message ? messageId : undefined}
      onCancel={(e) => {
        // Native Escape / backdrop dismissal resolves as "not confirmed".
        e.preventDefault();
        settle(false);
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-0 text-[var(--ink-strong)] shadow-2xl backdrop:bg-black/40"
    >
      {state && (
        <ConfirmDialogBody
          state={state}
          titleId={titleId}
          messageId={messageId}
          inputId={inputId}
          inputValue={inputValue}
          onInputChange={setInputValue}
          onSettle={settle}
        />
      )}
    </dialog>
  );

  return { confirm, alert, prompt, confirmDialog };
}
