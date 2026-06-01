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

interface DialogState {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string | null; // null => alert mode (single button)
  destructive: boolean;
}

type Resolver = (confirmed: boolean) => void;

/**
 * Accessible, promise-based replacement for native window.confirm()/alert().
 *
 * Built on the <dialog> element so destructive confirmations are keyboard- and
 * screen-reader-operable (focus trap, Escape to cancel, role="alertdialog") for
 * our WCAG-AA, low-literacy audience. One shared implementation replaces the
 * scattered native dialogs in FileManager, ConversationList, and PortfolioGrid.
 *
 * Usage:
 *   const { confirm, alert, confirmDialog } = useConfirm();
 *   if (await confirm({ title: "Delete file?", confirmLabel: "Delete" })) { ... }
 *   await alert({ title: "Could not delete. Please try again." });
 *   return (<>{...}{confirmDialog}</>);
 */
export function useConfirm() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolverRef = useRef<Resolver | null>(null);
  const [state, setState] = useState<DialogState | null>(null);
  const titleId = useId();
  const messageId = useId();

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    if (dialogRef.current?.open) dialogRef.current.close();
    setState(null);
    resolve?.(confirmed);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setState({
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? "Confirm",
      cancelLabel: opts.cancelLabel ?? "Cancel",
      destructive: opts.destructive ?? true,
    });
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const alert = useCallback((opts: AlertOptions): Promise<void> => {
    setState({
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.okLabel ?? "OK",
      cancelLabel: null,
      destructive: false,
    });
    return new Promise<void>((resolve) => {
      resolverRef.current = () => resolve();
    });
  }, []);

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
        <div className="p-6">
          <h2 id={titleId} className="font-display text-lg text-[var(--ink-strong)]">
            {state.title}
          </h2>
          {state.message && (
            <p id={messageId} className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              {state.message}
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            {state.cancelLabel !== null && (
              <button
                type="button"
                onClick={() => settle(false)}
                className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink-strong)]"
              >
                {state.cancelLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => settle(true)}
              className={
                state.destructive
                  ? "rounded-full border border-red-200 bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600"
                  : "primary-button px-4 py-2 text-sm"
              }
            >
              {state.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );

  return { confirm, alert, confirmDialog };
}
