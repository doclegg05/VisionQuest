/**
 * Server-sent event shape emitted by the chat route. Existing fields
 * (conversationId, done, error, text, heartbeat, quotaWarning) stay
 * untyped for backward compatibility. Agent-mode events use the `type`
 * discriminator so the UI can switch on it cleanly.
 *
 * See docs/superpowers/specs/2026-05-05-sage-agent-protocol.md.
 */
export interface ChatSseEvent {
  conversationId?: string;
  done?: boolean;
  error?: string;
  heartbeat?: boolean;
  quotaWarning?: string;
  text?: string;

  // Agent-mode events (Sage as site administrator).
  type?:
    | "text"
    | "tool_call"
    | "tool_result"
    | "action"
    | "attachment_ack";

  // tool_call
  callId?: string;
  tool?: string;
  args?: Record<string, unknown>;

  // tool_result
  status?: "success" | "error" | "pending";
  summary?: string;
  data?: unknown;

  // action
  action?: "navigate" | "open_form" | "open_resource" | "highlight";
  target?: string;
  label?: string;
  meta?: Record<string, unknown>;

  // attachment_ack
  attachmentId?: string;
  classification?: {
    kind: string;
    confidence: number;
    detectedFields?: Record<string, string>;
  };
  storagePath?: string;
}

export interface ChatSseParseResult {
  buffer: string;
  events: ChatSseEvent[];
}

function parseEventBlock(block: string): ChatSseEvent | null {
  const dataLines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"));

  if (dataLines.length === 0) return null;

  const payload = dataLines
    .map((line) => (line.startsWith("data: ") ? line.slice(6) : line.slice(5)))
    .join("\n");

  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" ? parsed as ChatSseEvent : null;
  } catch {
    return null;
  }
}

export function parseChatSseChunk(
  chunk: string,
  previousBuffer: string,
): ChatSseParseResult {
  const combined = (previousBuffer + chunk).replace(/\r\n/g, "\n");
  const blocks = combined.split("\n\n");
  const buffer = blocks.pop() ?? "";
  const events = blocks
    .map(parseEventBlock)
    .filter((event): event is ChatSseEvent => event !== null);

  return { buffer, events };
}

export function formatChatSseEvent(event: ChatSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function formatChatSseComment(comment: string): string {
  return `: ${comment.replace(/[\r\n]+/g, " ").trim()}\n\n`;
}
