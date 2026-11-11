/**
 * Reads the chat route's SSE stream: ids, text, tool and action events, and
 * the error event, which it throws as a SageSendError. Kept out of
 * ChatWindow.tsx so the reading rules are testable without a DOM.
 */

import { parseChatSseChunk, type ChatSseEvent } from "@/lib/chat/sse";
import { parseSageFailureCode } from "@/lib/chat/sage-failure";
import { SageSendError } from "@/lib/chat/send-outcome";
import { crisisBlockForLang, parseCrisisHelpLang } from "@/lib/chat/crisis-resource-blocks";

export interface AgentEventItem {
  id: string;
  kind: "tool" | "action";
  callId?: string;
  tool?: string;
  status?: "pending" | "success" | "error";
  summary: string;
  action?: ChatSseEvent["action"];
  target?: string;
  label?: string;
  meta?: Record<string, unknown>;
}

export function formatToolName(tool: string | undefined): string {
  if (!tool) return "Sage tool";
  return tool
    .replace(/^sage\./, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** A new list with `next` merged into the event of the same call, or added. */
function upsertAgentEvent(events: readonly AgentEventItem[], next: AgentEventItem): AgentEventItem[] {
  const existingIndex = next.callId
    ? events.findIndex((event) => event.callId === next.callId && event.kind === next.kind)
    : -1;
  if (existingIndex < 0) return [...events, next];
  return events.map((event, index) => (index === existingIndex ? { ...event, ...next } : event));
}

function nextAgentEvents(events: readonly AgentEventItem[], data: ChatSseEvent): readonly AgentEventItem[] {
  if (data.type === "tool_call") {
    return upsertAgentEvent(events, {
      id: data.callId ?? `tool-${events.length}`,
      kind: "tool",
      callId: data.callId,
      tool: data.tool,
      status: "pending",
      summary: `Checking ${formatToolName(data.tool).toLowerCase()}...`,
    });
  }
  if (data.type === "tool_result") {
    return upsertAgentEvent(events, {
      id: data.callId ?? `tool-${events.length}`,
      kind: "tool",
      callId: data.callId,
      tool: events.find((event) => event.callId === data.callId)?.tool,
      status: data.status,
      summary: data.summary || "Sage finished checking this.",
    });
  }
  if (data.type === "action") {
    const id = `action-${data.callId ?? events.length}-${data.target ?? data.label ?? "open"}`;
    const action: AgentEventItem = {
      id,
      kind: "action",
      action: data.action,
      target: data.target,
      label: data.label,
      meta: data.meta,
      summary: data.label || "Open",
    };
    return [...events, action];
  }
  return events;
}

export interface ChatStreamHandlers {
  /** The first event: the conversation, and the saved message a Try again can reuse. */
  onIds(ids: { conversationId: string; userMessageId: string | null }): void;
  /**
   * The 988 block, from the first event, when the student's message carried
   * a crisis signal. The full reply ends with it; a stream cut short does not.
   */
  onCrisisBlock?(block: string): void;
  /** All text so far, each time more arrives. */
  onText(fullContent: string): void;
  onEvents(events: AgentEventItem[]): void;
  onDone(conversationId: string | undefined): void;
}

export interface ChatStreamResult {
  completed: boolean;
  content: string;
  events: AgentEventItem[];
}

interface StreamState {
  completed: boolean;
  content: string;
  events: readonly AgentEventItem[];
}

function applyEvent(state: StreamState, data: ChatSseEvent, handlers: ChatStreamHandlers): StreamState {
  if (data.error) {
    throw new SageSendError(data.error, parseSageFailureCode(data), {
      crisisBlock: data.crisisBlock,
      userMessageId: data.userMessageId,
    });
  }
  if (data.conversationId && !data.done) {
    handlers.onIds({ conversationId: data.conversationId, userMessageId: data.userMessageId ?? null });
    const crisisLang = parseCrisisHelpLang(data.crisisHelp);
    if (crisisLang) handlers.onCrisisBlock?.(crisisBlockForLang(crisisLang));
  }
  const content = data.text ? state.content + data.text : state.content;
  if (data.text) handlers.onText(content);
  const events = nextAgentEvents(state.events, data);
  if (events !== state.events) handlers.onEvents([...events]);
  if (data.done) handlers.onDone(data.conversationId);
  return { completed: state.completed || Boolean(data.done), content, events };
}

export async function readChatStream(res: Response, handlers: ChatStreamHandlers): Promise<ChatStreamResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response stream");
  const decoder = new TextDecoder();
  let state: StreamState = { completed: false, content: "", events: [] };
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    const chunk = done ? `${decoder.decode()}\n\n` : decoder.decode(value, { stream: true });
    if (done && !chunk.trim() && !buffer.trim()) break;
    const parsed = parseChatSseChunk(chunk, buffer);
    buffer = parsed.buffer;
    for (const data of parsed.events) state = applyEvent(state, data, handlers);
    if (done) break;
  }
  return { completed: state.completed, content: state.content, events: [...state.events] };
}
