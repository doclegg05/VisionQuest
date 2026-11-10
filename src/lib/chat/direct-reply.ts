/**
 * The SSE response for a reply the chat route answers without a model call
 * (a form lookup or small talk): conversation id, any extras, the text, done.
 */

import type { AgentToolCallRecord } from "@/lib/sage/agent/types";
import { formatChatSseEvent, type ChatSseEvent } from "./sse";

export function createSseResponse(
  conversationId: string,
  text: string,
  extras: ChatSseEvent[] = [],
): Response {
  const encoder = new TextEncoder();
  const events: ChatSseEvent[] = [{ conversationId }, ...extras, { text }, { done: true, conversationId }];
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(formatChatSseEvent(event)));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** SSE extras for a present_form tool result (action card + tool events). */
export function presentFormSseExtras(record: AgentToolCallRecord): ChatSseEvent[] {
  const toolEvents: ChatSseEvent[] = [
    { type: "tool_call", callId: record.callId, tool: record.tool, args: record.args, status: "pending" },
    {
      type: "tool_result",
      callId: record.callId,
      status: record.result.status,
      summary: record.result.summary,
      data: record.result.data,
    },
  ];
  const action = record.result.action;
  if (!action) return toolEvents;
  return [
    ...toolEvents,
    { type: "action", action: action.action, target: action.target, label: action.label, meta: action.meta },
  ];
}
