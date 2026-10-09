"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { useConfirm } from "./useConfirm";

/** What a close request should do: close now, or ask before discarding input. */
export function closeIntent(dirty: boolean): "close" | "confirm-discard" {
  return dirty ? "confirm-discard" : "close";
}

interface FormDialogProps {
  title: string;
  /** True once the person has typed or changed anything worth keeping. */
  dirty: boolean;
  onClose: () => void;
  /** Tailwind max-width class for the panel. */
  widthClass?: string;
  children: React.ReactNode;
}

/**
 * Modal form on a native <dialog>: showModal() supplies focus containment,
 * Escape, and inertness for the page behind. Escape and a backdrop tap both
 * request a close; a dirty form asks "Discard changes?" first. Mount it only
 * while the form should be open.
 */
export function FormDialog({ title, dirty, onClose, widthClass = "max-w-md", children }: FormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { confirm, confirmDialog } = useConfirm();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const requestClose = useCallback(async () => {
    if (closeIntent(dirty) === "confirm-discard") {
      const discard = await confirm({
        title: "Discard changes?",
        message: "What you typed in this form will be lost.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
      });
      if (!discard) return;
    }
    onClose();
  }, [confirm, dirty, onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        void requestClose();
      }}
      onClick={(event) => {
        // A click on the <dialog> itself, not its panel, is a backdrop tap.
        if (event.target === event.currentTarget) void requestClose();
      }}
      className={`m-auto w-[calc(100vw-2rem)] ${widthClass} max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-0 text-[var(--ink-strong)] shadow-2xl backdrop:bg-black/40`}
    >
      <div className="space-y-4 p-5 sm:p-6">
        <h2 id={titleId} className="font-display text-lg text-[var(--ink-strong)]">
          {title}
        </h2>
        {children}
      </div>
      {confirmDialog}
    </dialog>
  );
}
