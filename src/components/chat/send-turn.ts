/**
 * What one chat send leaves on screen, as pure functions (E2b 7): the reply
 * when the stream ends, and the turn after a Stop or a failure. Kept out of
 * ChatWindow.tsx so handleSend stays short and each rule is testable.
 */

import type { ChatRole } from "@/lib/chat/commands";
import { resolveSendError, resolveStreamOutcome } from "@/lib/chat/send-outcome";
import type { AgentEventItem, ChatStreamResult } from "./chat-stream";
import { failedTurnMessages, type ChatMessage, type FailedTurn } from "./failed-turn";
import { stoppedTurnMessages, withEarlyCrisisHelp } from "./wait-and-stop";

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
  /** The student pressed Stop: no failure styling and no Try again. */
  stopped: boolean;
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

/** The turn after a Stop or a failure, with the 988 help when nothing shows it. */
export function messagesAfterSendError(input: SendErrorInput): SendErrorResult {
  const { id, crisisBlock } = input;
  if (input.stopped) {
    const messages = stoppedTurnMessages({ id, partial: input.partial, events: input.events, crisisBlock });
    return { messages, failedTurn: null, conversationId: null };
  }
  const outcome = resolveSendError(input.err, {
    priorContent: input.partial,
    audience: input.role === "student" ? "student" : "staff",
    isAdmin: input.role === "admin",
    savedUserMessageId: input.savedUserMessageId,
  });
  const messages = withEarlyCrisisHelp(failedTurnMessages(outcome, id), crisisBlock, id);
  const failedTurn = outcome.offerRetry || outcome.setupLink
    ? { messageId: id, offerRetry: outcome.offerRetry, setupLink: outcome.setupLink }
    : null;
  return { messages, failedTurn, conversationId: outcome.conversationId };
}
