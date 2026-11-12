/**
 * Pure pieces of E2 ("a wait the student can read"): the words that appear
 * under the typing dots, the turn a Stop leaves behind, and the 988 help a
 * stream that ends early must still show. Kept out of ChatWindow.tsx so each
 * rule is testable without a DOM, like failed-turn.ts.
 */

import type { ChatRole } from "@/lib/chat/commands";
import { crisisResourceBlockFor } from "@/lib/chat/crisis-safety-net";
import { detectCrisisSignal } from "@/lib/sage/crisis-patterns";
import type { AgentEventItem } from "./chat-stream";
import type { ChatMessage } from "./failed-turn";

/** How long Sage may say nothing before the dots get words under them. */
export const SLOW_REPLY_MS = 5000;

/** Read out, never shown, while the dots run and before the wait words. */
export const TYPING_SR_WORDS = "Sage is thinking.";

/** Shown and read out after SLOW_REPLY_MS, in place of TYPING_SR_WORDS. */
export const SLOW_REPLY_WORDS = "Sage is still thinking. This can take a minute.";

/** How long after a send Stop stays inert, so a double tap on Send is not a Stop. */
export const STOP_ARM_DELAY_MS = 800;

/** Added under any text Sage sent before the student pressed Stop. */
export const STOPPED_NOTE = "(You stopped Sage.)";

/** Same marker the server's safety net dedupes on (crisis-safety-net.ts). */
const CRISIS_MARKER = /988/;

/**
 * How long a send may wait for the stream's first event (ids and the crisis
 * flag) before the chat ends it with E1's "unknown" failure and Try again
 * (E7). Since E7 the route sends that event right after it saves the
 * message, before any context loads or model call, so it normally comes in
 * well under a second. Twenty seconds is far past that and still short of
 * the server's own bounds (the local model's 45 second first word, its
 * 300 second first byte), so it only fires when the request itself is stuck.
 */
export const FIRST_EVENT_TIMEOUT_MS = 20_000;

/**
 * No word from Sage for this long after the first event: the wait words say
 * Stop works. Past the local model's 45 second first word bound and its
 * startup retries, and a slow first load can still answer, so the chat does
 * not end the reply itself; Stop is already armed once the ids are in.
 */
export const REPLY_STALL_MS = 120_000;

/** Shown after REPLY_STALL_MS in place of SLOW_REPLY_WORDS. */
export const STALLED_REPLY_WORDS = "Sage is taking a long time. You can tap Stop, then tap Try again.";

/** Calls `onSlow` once after SLOW_REPLY_MS. Returns a cancel. */
export function startSlowReplyTimer(onSlow: () => void): () => void {
  const timer = setTimeout(onSlow, SLOW_REPLY_MS);
  return () => clearTimeout(timer);
}

/** Calls `onStalled` once after REPLY_STALL_MS. Returns a cancel. */
export function startStalledReplyTimer(onStalled: () => void): () => void {
  const timer = setTimeout(onStalled, REPLY_STALL_MS);
  return () => clearTimeout(timer);
}

interface StopArmInput {
  /** The stream's first event (conversation and message ids) has arrived. */
  idsArrived: boolean;
  /** Date.now() at the send, and now. */
  sentAt: number;
  now: number;
}

/** The first event has not come within FIRST_EVENT_TIMEOUT_MS of the send. */
export function firstEventOverdue({ idsArrived, sentAt, now }: StopArmInput): boolean {
  return !idsArrived && now - sentAt >= FIRST_EVENT_TIMEOUT_MS;
}

/**
 * Whether Stop does anything yet. The route flags a crisis message on the
 * stream's first event, so a Stop before it would lose the 988 help; and the
 * Stop button sits where Send was, so a double tap would stop the reply.
 */
export function stopArmed({ idsArrived, sentAt, now }: StopArmInput): boolean {
  return idsArrived && now - sentAt >= STOP_ARM_DELAY_MS;
}

/**
 * aria-busy for the conversation log. Busy only while words stream in, so a
 * streamed reply is read once when it is done; while Sage has sent nothing
 * the log is not busy, so the wait words in it are read out when they appear.
 */
export function logBusy(isLoading: boolean, streamingContent: string): boolean {
  return isLoading && Boolean(streamingContent);
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

/**
 * The 988 block for a message the chat cut off itself before the server's
 * first event (E9b): the timeout, or a dropped connection. The server's crisis
 * flag never arrived, so the chat runs the same patterns the server runs
 * (crisis-patterns.ts) on the text it sent, and picks the block by the
 * matched pattern's language. Null for a message with no crisis signal.
 */
export function localCrisisBlock(text: string): string | null {
  return crisisResourceBlockFor(detectCrisisSignal(text), "");
}

interface StoppedTurnInput {
  id: string;
  /** Text Sage streamed before the Stop. */
  partial: string;
  events: AgentEventItem[];
  /** The 988 block from the stream's first event, when it sent one. */
  crisisBlock: string | null;
  /** The student's saved message, from the first event. */
  savedUserMessageId: string | null;
}

/** A Stop that left nothing behind can be asked again (E9b 2). */
export function stopOffersRetry(partial: string, savedUserMessageId: string | null): boolean {
  return !partial && savedUserMessageId !== null;
}

/**
 * What a Stop leaves on screen. It was the student's choice, so there is no
 * failure styling and no failure sentence. A Stop before any text, with the
 * saved message known, offers Try again on that message, so the box being
 * empty is never a dead end. A Stop with text keeps that text and no Try again.
 */
export function stoppedTurnMessages({ id, partial, events, crisisBlock, savedUserMessageId }: StoppedTurnInput): ChatMessage[] {
  const retry = stopOffersRetry(partial, savedUserMessageId);
  const reply: ChatMessage = {
    id,
    role: "assistant",
    content: partial ? `${partial}\n\n${STOPPED_NOTE}` : STOPPED_NOTE,
    events: events.length > 0 ? events : undefined,
    ...(retry ? { failure: { keepOnRetry: false, retryOf: savedUserMessageId, alert: false } } : {}),
  };
  return withEarlyCrisisHelp([reply], crisisBlock, id);
}
