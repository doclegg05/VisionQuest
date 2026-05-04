export interface ChatSseEvent {
  conversationId?: string;
  done?: boolean;
  error?: string;
  heartbeat?: boolean;
  quotaWarning?: string;
  text?: string;
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
