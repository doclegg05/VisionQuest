/**
 * The network side of one chat send, kept out of ChatWindow.tsx (E2b 7):
 * the request itself, the goal count goal polling compares against, and
 * the canned opener that waits on the student's stage.
 */

import { apiFetch } from "@/lib/api";
import { STAGE_OPENERS } from "@/lib/chat/stage-openers";
import type { ConversationStage } from "@/lib/sage/stage";
import { readSendError } from "./FailedReplyActions";

interface GreetingInput {
  /** The opener a ?stage= link asked for, shown at once. */
  opener: string | null;
  deriveStage: () => Promise<ConversationStage>;
  /** False once the send that asked for the greeting is over. */
  isCurrent: () => boolean;
  show: (text: string) => void;
}

/**
 * B4: the canned opener on a new conversation while Sage's first word is on
 * its way. Without a ?stage= opener it waits for the stage (typically under
 * 200 ms) and shows only if the same send is still waiting.
 */
export function startOptimisticGreeting({ opener, deriveStage, isCurrent, show }: GreetingInput): void {
  if (opener) {
    show(opener);
    return;
  }
  void deriveStage().then((stage) => {
    if (isCurrent()) show(STAGE_OPENERS[stage]);
  });
}

/** How many goals the student has now, so goal polling can spot a new one. 0 on any failure. */
export function fetchGoalCount(): Promise<number> {
  return apiFetch("/api/goals")
    .then(async (res) => {
      if (!res.ok) return 0;
      const data = await res.json();
      return Array.isArray(data.goals) ? data.goals.length : 0;
    })
    .catch(() => 0);
}

interface ChatRequest {
  text: string;
  conversationId: string | null;
  stage: string | undefined;
  attachmentIds?: string[];
  retryOf?: string | null;
  signal: AbortSignal;
}

/** Posts one message; throws the server's own failure when it refuses. */
export async function postChatMessage({ text, conversationId, stage, attachmentIds, retryOf, signal }: ChatRequest): Promise<Response> {
  const res = await apiFetch("/api/chat/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      message: text,
      conversationId,
      // Only send on the first message of a new conversation
      requestedStage: conversationId ? undefined : stage,
      attachmentIds: attachmentIds && attachmentIds.length > 0 ? attachmentIds : undefined,
      // null is kept: a Try again with no saved id, which the route matches (E9b 6).
      retryOf,
    }),
  });
  if (!res.ok) throw await readSendError(res);
  return res;
}
