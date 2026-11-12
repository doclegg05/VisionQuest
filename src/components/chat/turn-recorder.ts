/**
 * What one send has received so far, kept beside the stream handlers so
 * ChatWindow's handleSend stays short. A Stop or a failure reads it to show
 * the partial reply, its tool events, the 988 help the first event flagged,
 * and the saved message a Try again can reuse.
 */

import type { AgentEventItem, ChatStreamHandlers } from "./chat-stream";

/** What a send had received when it stopped or failed. */
export interface SentSoFar {
  partial: string;
  events: AgentEventItem[];
  crisisBlock: string | null;
  savedUserMessageId: string | null;
  /** The server's first event (ids, and the crisis flag with them) arrived. */
  firstEventSeen: boolean;
}

export interface TurnRecorderDeps {
  /** Tells the Stop gate the ids are in (send-abort.ts). */
  noteIds(): void;
  noteConversation(nextId: string | undefined): void;
  /** The first real word arrived (B4: it replaces the canned opener). */
  onFirstText(): void;
  showText(content: string): void;
  showEvents(events: AgentEventItem[]): void;
}

export interface TurnRecorder {
  handlers: ChatStreamHandlers;
  sent(): SentSoFar;
}

const NOTHING_YET: SentSoFar = {
  partial: "",
  events: [],
  crisisBlock: null,
  savedUserMessageId: null,
  firstEventSeen: false,
};

export function createTurnRecorder(deps: TurnRecorderDeps): TurnRecorder {
  let sent = NOTHING_YET;
  const handlers: ChatStreamHandlers = {
    onIds: (ids) => {
      sent = { ...sent, savedUserMessageId: ids.userMessageId, firstEventSeen: true };
      deps.noteConversation(ids.conversationId);
      // Last: a Stop kept from before the ids ends the reply here (E2c 2).
      deps.noteIds();
    },
    onCrisisBlock: (block) => {
      sent = { ...sent, crisisBlock: block };
    },
    onText: (content) => {
      if (!sent.partial) deps.onFirstText();
      sent = { ...sent, partial: content };
      deps.showText(content);
    },
    onEvents: (events) => {
      sent = { ...sent, events };
      deps.showEvents(events);
    },
    onDone: deps.noteConversation,
  };
  return { handlers, sent: () => sent };
}
