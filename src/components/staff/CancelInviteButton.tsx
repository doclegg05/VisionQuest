"use client";

import { useRef, useState } from "react";

/**
 * Runs `action` unless a run is already in flight. The guard lives in a ref,
 * not state, because a second tap can land before React re-renders the
 * disabled button (MEMORY Known Issues: repeat taps).
 */
export async function runOnce(ref: { current: boolean }, action: () => Promise<void>): Promise<void> {
  if (ref.current) return;
  ref.current = true;
  try {
    await action();
  } finally {
    ref.current = false;
  }
}

interface CancelInviteButtonViewProps {
  pending: boolean;
  onClick: () => void;
}

export function CancelInviteButtonView({ pending, onClick }: CancelInviteButtonViewProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-busy={pending}
      className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--ink-muted)] hover:text-[var(--ink-strong)] hover:underline disabled:cursor-not-allowed disabled:opacity-60 disabled:no-underline"
    >
      {pending ? "Canceling…" : "Cancel invite"}
    </button>
  );
}

interface CancelInviteButtonProps {
  onCancel: () => Promise<void>;
}

/** One row's Cancel invite button: disabled and relabeled while its cancel is in flight. */
export function CancelInviteButton({ onCancel }: CancelInviteButtonProps) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  function handleClick() {
    void runOnce(inFlight, async () => {
      setPending(true);
      try {
        await onCancel();
      } finally {
        setPending(false);
      }
    });
  }

  return <CancelInviteButtonView pending={pending} onClick={handleClick} />;
}
