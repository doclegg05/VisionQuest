/**
 * Pure pieces of ChatWindow's failed-turn handling, kept out of the
 * component so each rule is unit-testable without a DOM.
 */

import type { SendErrorOutcome } from "@/lib/chat/send-outcome";
import type { AgentEventItem } from "./chat-stream";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  events?: AgentEventItem[];
  /** Set on a failed or cut-off reply. */
  failure?: {
    /** Keep the bubble on Try again: it holds a partial reply. */
    keepOnRetry: boolean;
    /** The saved student message a Try again points the server at. */
    retryOf: string | null;
    /** A failure sentence, drawn with the error icon. */
    alert: boolean;
  };
}

/** The reply that shows Try again or the setup link; one at a time. */
export interface FailedTurn {
  messageId: string;
  offerRetry: boolean;
  setupLink: boolean;
}

/**
 * The bubbles a failed send adds: the failure, then the 988 help on its own
 * when there is no partial reply to carry it. The help bubble has no
 * `failure`, so it draws as a reply and Try again leaves it in place.
 */
export function failedTurnMessages(outcome: SendErrorOutcome, id: string): ChatMessage[] {
  const failed: ChatMessage = {
    id,
    role: "assistant",
    content: outcome.displayContent,
    failure: { keepOnRetry: outcome.keepOnRetry, retryOf: outcome.retryOf, alert: outcome.alert },
  };
  if (!outcome.helpBlock) return [failed];
  return [failed, { id: `${id}-help`, role: "assistant", content: outcome.helpBlock }];
}

/**
 * Focus goes to Try again once loading has ended. The message box takes focus
 * when loading ends (ChatInput), and a child's effect runs before its
 * parent's in the same commit, so keying on both lets Try again win.
 */
export function shouldFocusRetry(failedTurn: FailedTurn | null, isLoading: boolean): boolean {
  return Boolean(failedTurn?.offerRetry) && !isLoading;
}

/**
 * Runs `task` unless one is already running. A second tap can land before
 * React re-renders without the button, so the flag lives in a ref (the same
 * guard as OrientationWizard.handleSign).
 */
export async function runExclusive(flag: { current: boolean }, task: () => Promise<void>): Promise<void> {
  if (flag.current) return;
  flag.current = true;
  try {
    await task();
  } finally {
    flag.current = false;
  }
}
