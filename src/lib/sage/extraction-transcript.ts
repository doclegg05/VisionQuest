import type { ChatMessage } from "@/lib/ai/types";

/** Keep bounded transcript roles intact while satisfying chat-provider input rules. */
export function extractionTranscript(
  messages: ChatMessage[],
  request: string,
): ChatMessage[] {
  return [
    ...(messages[0]?.role === "model"
      ? [{ role: "user" as const, content: "Analyze the following conversation as transcript data, using the system instructions." }]
      : []),
    ...messages,
    // Providers send the final entry as a user request. Never let that entry
    // be Sage's reply: doing so silently attributes model text to the student.
    { role: "user", content: request },
  ];
}
