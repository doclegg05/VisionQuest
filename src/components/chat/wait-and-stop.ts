/**
 * Pure pieces of E2 ("a wait the student can read"): the words that appear
 * under the typing dots, the turn a Stop leaves behind, and the 988 help a
 * stream that ends early must still show. Kept out of ChatWindow.tsx so each
 * rule is testable without a DOM, like failed-turn.ts.
 */

import type { ChatRole } from "@/lib/chat/commands";
import type { AgentEventItem } from "./chat-stream";
import type { ChatMessage } from "./failed-turn";

/** How long Sage may say nothing before the dots get words under them. */
export const SLOW_REPLY_MS = 5000;

export const SLOW_REPLY_WORDS = "Sage is thinking. This can take a minute.";

/** Added under any text Sage sent before the student pressed Stop. */
export const STOPPED_NOTE = "(You stopped Sage.)";

/** Same marker the server's safety net dedupes on (crisis-safety-net.ts). */
const CRISIS_MARKER = /988/;

/** Calls `onSlow` once after SLOW_REPLY_MS. Returns a cancel. */
export function startSlowReplyTimer(onSlow: () => void): () => void {
  const timer = setTimeout(onSlow, SLOW_REPLY_MS);
  return () => clearTimeout(timer);
}

interface OpenerInput {
  role: ChatRole;
  isFirstMessage: boolean;
  /** The server resolved Sage to the local model for this deployment. */
  localProvider: boolean;
}

/**
 * The canned opener stands in for a reply that comes within a second or two.
 * On the local model the real reply can be 20 seconds or more away, so the
 * opener would sit there looking like Sage's answer, then vanish and be
 * replaced. There the dots and the wait words show instead.
 */
export function showsCannedOpener({ role, isFirstMessage, localProvider }: OpenerInput): boolean {
  return role === "student" && isFirstMessage && !localProvider;
}

function helpBubble(id: string, crisisBlock: string): ChatMessage {
  return { id: `${id}-help`, role: "assistant", content: crisisBlock.replace(/^\n+/, "") };
}

/**
 * The 988 help as its own bubble when the server flagged the message as a
 * crisis on its first event and nothing on screen for this turn shows it yet.
 * The server appends the block at the end of a full reply, so a stream that
 * ends early (Stop, a dropped connection) would otherwise lose it.
 */
export function withEarlyCrisisHelp(messages: ChatMessage[], crisisBlock: string | null, id: string): ChatMessage[] {
  if (!crisisBlock) return messages;
  if (messages.some((message) => CRISIS_MARKER.test(message.content))) return messages;
  return [...messages, helpBubble(id, crisisBlock)];
}

interface StoppedTurnInput {
  id: string;
  /** Text Sage streamed before the Stop. */
  partial: string;
  events: AgentEventItem[];
  /** The 988 block from the stream's first event, when it sent one. */
  crisisBlock: string | null;
}

/**
 * What a Stop leaves on screen. It was the student's choice, so there is no
 * failure styling, no failure sentence and no Try again.
 */
export function stoppedTurnMessages({ id, partial, events, crisisBlock }: StoppedTurnInput): ChatMessage[] {
  const reply: ChatMessage = {
    id,
    role: "assistant",
    content: partial ? `${partial}\n\n${STOPPED_NOTE}` : STOPPED_NOTE,
    events: events.length > 0 ? events : undefined,
  };
  return withEarlyCrisisHelp([reply], crisisBlock, id);
}
