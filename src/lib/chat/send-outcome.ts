/**
 * Pure decision logic for what ChatWindow shows after a send attempt ends —
 * factored out of ChatWindow.tsx's handleSend so the "does this failure
 * deserve a retry control" rule is unit-testable without a DOM.
 *
 * Two send-attempt outcomes reach this logic:
 *  - The SSE stream reader finishes (with or without a `done` event) and no
 *    exception was thrown — resolveStreamOutcome.
 *  - Something threw before or during the stream (non-2xx response, an SSE
 *    `error` event, a rejected fetch, "no response stream") — resolveSendError.
 *
 * Both agree on one rule: an assistant turn that ends with ZERO visible
 * content — whether it never started (a thrown error) or it "finished" with
 * nothing to show — is a dead end unless a retry control is offered. A turn
 * that produced SOME content before an interruption already had a retry
 * path (the partial-content case below); this only closes the zero-content
 * gap where none existed before.
 */

import { sageFailureMessage, type SageFailureAudience, type SageFailureCode } from "./sage-failure";

export interface StreamOutcome {
  content: string;
  offerRetry: boolean;
}

/**
 * A stream that opened and then ended with nothing to show. The route saves
 * the student's message before it opens the stream, so it was not lost.
 */
const NO_CONTENT_MESSAGE = "Sage did not send an answer. Your message was not lost. Tap Try again.";
const CUT_OFF_NOTE = "\n\n(Sage got cut off. Tap Try again for the full answer.)";

export function resolveStreamOutcome(streamCompleted: boolean, fullContent: string): StreamOutcome {
  if (!fullContent) {
    return { content: NO_CONTENT_MESSAGE, offerRetry: true };
  }
  if (!streamCompleted) {
    return { content: fullContent + CUT_OFF_NOTE, offerRetry: true };
  }
  return { content: fullContent, offerRetry: false };
}

/**
 * A failure the server described: `message` is the server's sentence for
 * the student (with the 988 block when the message carried a crisis
 * signal), and `failure` is the cause code it sent, when it sent one.
 */
export class SageSendError extends Error {
  readonly failure: SageFailureCode | null;

  constructor(message: string, failure: SageFailureCode | null) {
    super(message);
    this.name = "SageSendError";
    this.failure = failure;
  }
}

export interface SendErrorOutcome {
  /** The one assistant turn shown for this failed send. */
  displayContent: string;
  failure: SageFailureCode;
  offerRetry: boolean;
  /** Staff only: a link to Settings, where their own AI key lives. */
  showSettingsLink: boolean;
}

export function resolveSendError(
  err: unknown,
  priorContent: string,
  audience: SageFailureAudience,
): SendErrorOutcome {
  // A thrown error with content already streamed in front of it kept its
  // own recovery path before this change; don't alter that behavior here.
  const offerRetry = !priorContent;
  if (!(err instanceof SageSendError)) {
    // A browser's own error text ("Failed to fetch") is not for students.
    // The send may never have reached the server, so no "not lost" claim.
    return {
      displayContent: sageFailureMessage("unknown", { audience, messageSaved: false }),
      failure: "unknown",
      offerRetry,
      showSettingsLink: false,
    };
  }
  const failure = err.failure ?? "unknown";
  return {
    displayContent: err.message,
    failure,
    offerRetry,
    showSettingsLink: audience === "staff" && failure === "not_set_up",
  };
}

interface RetryableMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/**
 * The transcript to resend from: drops the failed turn and the student
 * message it answered, because the resend adds that message back. Without
 * this a retry showed the student's message twice.
 */
export function prepareRetry<M extends RetryableMessage>(
  messages: readonly M[],
  failedId: string,
): { messages: M[]; text: string } | null {
  const failedIndex = messages.findIndex((message) => message.id === failedId);
  if (failedIndex < 0) return null;
  const userIndex = messages.slice(0, failedIndex).map((message) => message.role).lastIndexOf("user");
  if (userIndex < 0) return null;
  return {
    messages: messages.filter((_, index) => index !== failedIndex && index !== userIndex),
    text: messages[userIndex].content,
  };
}
