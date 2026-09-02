type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The message the student sees, can edit, and sends themselves from the Ask
 * Sage modal. Nothing is posted until they tap Send, so the transcript only
 * ever holds words the student chose to send (F24 / VQ-R-007).
 */
export function buildAskSagePrompt(goalContent: string): string {
  const prompt = `My monthly goal is: "${goalContent}". Can you give me 3 or 4 small weekly steps I can check off to reach it?`;
  return prompt;
}

function parseSseText(payload: string): string | null {
  try {
    const data = JSON.parse(payload) as { text?: unknown };
    return typeof data?.text === "string" ? data.text : null;
  } catch {
    return null;
  }
}

/**
 * Posts the student's own message to the chat API and streams Sage's reply
 * back through onText (called with the accumulated text so far). Resolves
 * with the full reply. Only ever called from the modal's submit handler.
 */
export async function streamSageReply(
  message: string,
  fetcher: Fetcher,
  onText: (accumulated: string) => void,
): Promise<string> {
  const res = await fetcher("/api/chat/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error("Could not contact Sage");

  const reader = res.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let accumulated = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const text = parseSseText(line.slice(6));
      if (text) {
        accumulated += text;
        onText(accumulated);
      }
    }
  }
  return accumulated;
}
