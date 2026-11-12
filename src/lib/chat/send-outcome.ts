/**
 * Pure decision logic for what ChatWindow shows after a send attempt ends,
 * kept out of the component so each rule is unit-testable without a DOM.
 *
 * Two send-attempt outcomes reach this logic:
 *  - The SSE stream reader finishes (with or without a `done` event) and no
 *    exception was thrown: resolveStreamOutcome.
 *  - Something threw before or during the stream (non-2xx response, an SSE
 *    `error` event, a rejected fetch, "no response stream"): resolveSendError.
 *
 * One rule holds for both: the words say "tap Try again" exactly when the
 * Try again button shows (`offersRetry` in sage-failure.ts).
 */

import {
  CUT_OFF_NOTE,
  RETRIED_CUT_OFF_NOTE,
  cutOffReply,
  offersRetry,
  parseSageFailureCode,
  sageFailureMessage,
  type SageFailureAudience,
  type SageFailureCode,
} from "./sage-failure";

export interface StreamOutcome {
  content: string;
  offerRetry: boolean;
  /** A partial reply stays in the transcript when the student taps Try again. */
  keepOnRetry: boolean;
}

/**
 * A stream that opened and then ended with nothing to show. The route saves
 * the student's message before it opens the stream, so it was not lost.
 */
const NO_CONTENT_MESSAGE = "Sage did not send an answer. Your message was not lost. Tap Try again.";

export function resolveStreamOutcome(streamCompleted: boolean, fullContent: string): StreamOutcome {
  if (!fullContent) {
    return { content: NO_CONTENT_MESSAGE, offerRetry: true, keepOnRetry: false };
  }
  if (!streamCompleted) {
    return { content: `${fullContent}\n\n${CUT_OFF_NOTE}`, offerRetry: true, keepOnRetry: true };
  }
  return { content: fullContent, offerRetry: false, keepOnRetry: false };
}

interface SageSendErrorDetails {
  /** The 988 block the server added to `message`, when it added one. */
  crisisBlock?: string | null;
  /** The id of the student's saved message, when the server saved it. */
  userMessageId?: string | null;
  /** The conversation that message was saved in. */
  conversationId?: string | null;
}

/**
 * A failure the server described: `message` is the server's sentence for
 * the student (with the 988 block when the message carried a crisis
 * signal), and `failure` is the cause code it sent, when it sent one.
 */
export class SageSendError extends Error {
  readonly failure: SageFailureCode | null;
  readonly crisisBlock: string | null;
  readonly userMessageId: string | null;
  readonly conversationId: string | null;

  constructor(message: string, failure: SageFailureCode | null, details: SageSendErrorDetails = {}) {
    super(message);
    this.name = "SageSendError";
    this.failure = failure;
    this.crisisBlock = details.crisisBlock || null;
    this.userMessageId = details.userMessageId || null;
    this.conversationId = details.conversationId || null;
  }
}

function stringField(data: unknown, key: string): string | null {
  if (typeof data !== "object" || data === null) return null;
  const value: unknown = Object.getOwnPropertyDescriptor(data, key)?.value;
  return typeof value === "string" && value ? value : null;
}

/** A request error: the registry middleware writes its text for the user. */
function isRequestError(status: number): boolean {
  return status >= 400 && status < 500;
}

/**
 * Reads a refused send's JSON body. The server's own text is shown only when
 * the server chose it for the student: a body with a `failure` code, or a
 * request error (4xx, rate limits included), which no Try again can fix.
 * Anything else, such as a framework's "Internal server error", becomes a
 * plain Error, which resolveSendError turns into the fixed sentence.
 */
export function parseSendErrorBody(status: number, data: unknown): Error {
  const text = stringField(data, "error");
  const failure = parseSageFailureCode(data);
  if (!text || (failure === null && !isRequestError(status))) return new Error(`Send refused (${status})`);
  return new SageSendError(text, failure, {
    crisisBlock: stringField(data, "crisisBlock"),
    userMessageId: stringField(data, "userMessageId"),
    conversationId: stringField(data, "conversationId"),
  });
}

export interface SendErrorContext {
  /** Text Sage streamed before the failure. */
  priorContent: string;
  audience: SageFailureAudience;
  isAdmin: boolean;
  /** The saved message id the stream reported before it failed, if any. */
  savedUserMessageId: string | null;
}

export interface SendErrorOutcome {
  /** The one assistant turn shown for this failed send. */
  displayContent: string;
  /** Null for a sentence with no cause code: a rate limit, or the chat's own timeout. */
  failure: SageFailureCode | null;
  offerRetry: boolean;
  /** Keep the bubble on Try again: it carries a partial reply. */
  keepOnRetry: boolean;
  /** The saved student message a Try again points the server at. */
  retryOf: string | null;
  /** The conversation the server saved the message in, so Try again uses it. */
  conversationId: string | null;
  /**
   * The 988 block as its own bubble, when there is no partial reply to carry
   * it, so it is not drawn as part of the error. It stays on Try again.
   */
  helpBlock: string | null;
  /** Draw the bubble as an error (no partial reply in it). */
  alert: boolean;
  /** Admin only, when Sage is not set up: a link to Program Setup. */
  setupLink: boolean;
}

function describeError(err: unknown, context: SendErrorContext) {
  if (err instanceof SageSendError) return err;
  // A browser's own error text ("Failed to fetch") is not for students.
  // The client cannot add the 988 block here: only the server runs the
  // crisis check, and no answer came back from it.
  const messageSaved = context.savedUserMessageId !== null;
  const text = sageFailureMessage("unknown", { audience: context.audience, messageSaved, canRetry: true });
  return new SageSendError(text, "unknown");
}

/** The error sentence and the 988 block apart, when the server sent both. */
function splitHelpBlock(message: string, crisisBlock: string | null): { sentence: string; helpBlock: string | null } {
  if (!crisisBlock || !message.endsWith(crisisBlock)) return { sentence: message, helpBlock: null };
  // The block opens with the line break that joined it to the sentence.
  return { sentence: message.slice(0, -crisisBlock.length), helpBlock: crisisBlock.replace(/^\n+/, "") };
}

/**
 * The chat ended the send itself: no first event came within its bound
 * (FIRST_EVENT_TIMEOUT_MS in src/components/chat/wait-and-stop.ts). Nothing
 * says the message was saved, because no answer came back to say so, and it
 * does not send the student to the instructor for what is often a weak signal.
 */
export const FIRST_EVENT_TIMEOUT_WORDS = "We could not reach Sage. Check your internet, then tap Try again.";

/** What the first-event timeout shows: its own sentence and Try again (E9b 3). */
export function firstEventTimeoutOutcome(): SendErrorOutcome {
  return {
    displayContent: FIRST_EVENT_TIMEOUT_WORDS,
    failure: null,
    offerRetry: true,
    keepOnRetry: false,
    retryOf: null,
    conversationId: null,
    helpBlock: null,
    alert: true,
    setupLink: false,
  };
}

export function resolveSendError(err: unknown, context: SendErrorContext): SendErrorOutcome {
  const described = describeError(err, context);
  const failure = described.failure;
  const offerRetry = failure !== null && offersRetry(failure);
  const partial = context.priorContent;
  const split = splitHelpBlock(described.message, described.crisisBlock);
  const displayContent = partial
    ? cutOffReply(partial, failure ?? "unknown", context.audience) + (described.crisisBlock ?? "")
    : split.sentence;
  return {
    displayContent,
    failure,
    offerRetry,
    keepOnRetry: Boolean(partial),
    retryOf: described.userMessageId ?? context.savedUserMessageId,
    conversationId: described.conversationId,
    helpBlock: partial ? null : split.helpBlock,
    alert: !partial,
    setupLink: context.audience === "staff" && context.isAdmin && failure === "not_set_up",
  };
}

interface RetryableMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  failure?: { keepOnRetry: boolean; retryOf: string | null };
}

/** A kept cut-off reply after Try again: its button is gone, so the note changes. */
function retireCutOffNote<M extends RetryableMessage>(message: M): M {
  return { ...message, content: message.content.replace(CUT_OFF_NOTE, RETRIED_CUT_OFF_NOTE) };
}

/**
 * The transcript to resend from. The student's message stays: the retry
 * answers it and does not add it again. The failed turn goes, unless it
 * carries a partial reply, which stays in view with its note rewritten.
 */
export function prepareRetry<M extends RetryableMessage>(
  messages: readonly M[],
  failedId: string,
): { messages: M[]; text: string; retryOf: string | null } | null {
  const failedIndex = messages.findIndex((message) => message.id === failedId);
  if (failedIndex < 0) return null;
  const userIndex = messages.slice(0, failedIndex).map((message) => message.role).lastIndexOf("user");
  if (userIndex < 0) return null;
  const failed = messages[failedIndex];
  const keep = failed.failure?.keepOnRetry ?? false;
  return {
    messages: keep
      ? messages.map((message, index) => (index === failedIndex ? retireCutOffNote(message) : message))
      : messages.filter((_, index) => index !== failedIndex),
    text: messages[userIndex].content,
    retryOf: failed.failure?.retryOf ?? null,
  };
}
