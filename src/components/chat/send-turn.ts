/**
 * What one chat send leaves on screen, as pure functions (E2b 7): the reply
 * when the stream ends, and the turn after a Stop or a failure. Kept out of
 * ChatWindow.tsx so handleSend stays short and each rule is testable.
 */

import type { ChatRole } from "@/lib/chat/commands";
import { SageSendError, firstEventTimeoutOutcome, resolveSendError, resolveStreamOutcome, type SendErrorOutcome } from "@/lib/chat/send-outcome";
import type { AgentEventItem, ChatStreamResult } from "./chat-stream";
import { failedTurnMessages, type ChatMessage, type FailedTurn } from "./failed-turn";
import { localCrisisBlock, stopOffersRetry, stoppedTurnMessages, withEarlyCrisisHelp } from "./wait-and-stop";

interface TurnResultInput {
  result: ChatStreamResult;
  id: string;
  savedUserMessageId: string | null;
  /** The 988 block the server flagged on the first event, if any. */
  crisisBlock: string | null;
}

interface TurnResult {
  messages: ChatMessage[];
  failedTurn: FailedTurn | null;
}

/** The reply a stream leaves, with Try again when it ended early or empty. */
export function turnResultMessages({ result, id, savedUserMessageId, crisisBlock }: TurnResultInput): TurnResult {
  const outcome = resolveStreamOutcome(result.completed, result.content);
  const reply: ChatMessage = {
    id,
    role: "assistant",
    content: outcome.content,
    events: result.events.length > 0 ? result.events : undefined,
    failure: outcome.offerRetry
      ? { keepOnRetry: outcome.keepOnRetry, retryOf: savedUserMessageId, alert: !result.content }
      : undefined,
  };
  // A stream that ended early never reached the 988 block at its end.
  const messages = result.completed ? [reply] : withEarlyCrisisHelp([reply], crisisBlock, id);
  const failedTurn = outcome.offerRetry ? { messageId: id, offerRetry: true, setupLink: false } : null;
  return { messages, failedTurn };
}

interface SendErrorInput {
  err: unknown;
  /** The student pressed Stop: no failure styling, Try again only with nothing streamed. */
  stopped: boolean;
  /** The chat ended the send because no first event came in time (E9b 3). */
  timedOut: boolean;
  /** The message the student sent, for the chat's own crisis check (E9b 1). */
  text: string;
  /** The server's first event (ids and its crisis flag) arrived. */
  firstEventSeen: boolean;
  /** Text Sage streamed before the Stop or failure. */
  partial: string;
  events: AgentEventItem[];
  crisisBlock: string | null;
  role: ChatRole;
  savedUserMessageId: string | null;
  id: string;
}

interface SendErrorResult extends TurnResult {
  /** The conversation the server saved the message in, or null to keep the current one. */
  conversationId: string | null;
}

/**
 * The 988 block this turn must show. The server's flag when it sent one.
 * When the chat cut the send off itself before the first event (the timeout
 * or a dropped connection, not a failure the server answered), the server's
 * flag never came, so the chat checks the text with the same patterns.
 */
function crisisBlockFor(input: SendErrorInput): string | null {
  if (input.crisisBlock) return input.crisisBlock;
  if (input.firstEventSeen || input.err instanceof SageSendError) return null;
  return localCrisisBlock(input.text);
}

function sendErrorOutcome(input: SendErrorInput): SendErrorOutcome {
  if (input.timedOut) return firstEventTimeoutOutcome();
  return resolveSendError(input.err, {
    priorContent: input.partial,
    audience: input.role === "student" ? "student" : "staff",
    isAdmin: input.role === "admin",
    savedUserMessageId: input.savedUserMessageId,
  });
}

/** The turn after a Stop or a failure, with the 988 help when nothing shows it. */
export function messagesAfterSendError(input: SendErrorInput): SendErrorResult {
  const { id, partial, savedUserMessageId } = input;
  const crisisBlock = crisisBlockFor(input);
  if (input.stopped) {
    const messages = stoppedTurnMessages({ id, partial, events: input.events, crisisBlock, savedUserMessageId });
    const failedTurn = stopOffersRetry(partial, savedUserMessageId) ? { messageId: id, offerRetry: true, setupLink: false } : null;
    return { messages, failedTurn, conversationId: null };
  }
  const outcome = sendErrorOutcome(input);
  const messages = withEarlyCrisisHelp(failedTurnMessages(outcome, id), crisisBlock, id);
  const failedTurn = outcome.offerRetry || outcome.setupLink
    ? { messageId: id, offerRetry: outcome.offerRetry, setupLink: outcome.setupLink }
    : null;
  return { messages, failedTurn, conversationId: outcome.conversationId };
}
