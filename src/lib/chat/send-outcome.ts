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

export interface StreamOutcome {
  content: string;
  offerRetry: boolean;
}

const NO_CONTENT_MESSAGE = "I didn't receive a complete response. Please try again.";

export function resolveStreamOutcome(streamCompleted: boolean, fullContent: string): StreamOutcome {
  if (!fullContent) {
    return { content: NO_CONTENT_MESSAGE, offerRetry: true };
  }
  if (!streamCompleted) {
    return { content: `${fullContent} (Response may be incomplete)`, offerRetry: true };
  }
  return { content: fullContent, offerRetry: false };
}

export interface SendErrorOutcome {
  /** Raw error text — shown in the ChatErrorBanner. */
  bannerMessage: string;
  /** What gets appended to the transcript as the assistant's turn. */
  displayContent: string;
  offerRetry: boolean;
}

const API_KEY_ISSUE_MESSAGE =
  "Sage needs a Gemini API key before it can respond. Open Settings to add a personal key, or ask staff to configure the shared one.";

function isApiKeyIssue(message: string): boolean {
  return message.includes("API key") || message.includes("Sage is not configured");
}

export function resolveSendError(err: unknown, priorContent: string): SendErrorOutcome {
  const bannerMessage =
    err instanceof Error ? err.message : "Sorry, I had trouble responding. Please try again.";
  const displayContent = isApiKeyIssue(bannerMessage) ? API_KEY_ISSUE_MESSAGE : bannerMessage;
  return {
    bannerMessage,
    displayContent,
    // A thrown error with content already streamed in front of it kept its
    // own recovery path before this change; don't alter that behavior here.
    offerRetry: !priorContent,
  };
}
