import { generateResponse } from "@/lib/gemini";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

const SUMMARY_SYSTEM_PROMPT = `You are a coaching session analyst. Given a conversation between an AI coach (Sage) and a student, write a concise ~200-word summary covering:

1. Key themes discussed
2. Commitments the student made (goals, action items, next steps)
3. Barriers or challenges mentioned
4. Mood and emotional signals observed
5. Progress made since previous sessions (if mentioned)
6. Important personal context (family situation, work, health, or financial mentions)

Write in third person, past tense. Be factual and neutral. Do not include pleasantries or preamble — output only the summary paragraph(s).`;

/**
 * Generates a ~200-word summary of a coaching conversation and saves it to the
 * Conversation record. Returns the generated summary text.
 */
export async function summarizeConversation(
  conversationId: string,
  messages: { role: "user" | "model"; content: string }[],
  apiKey: string
): Promise<string> {
  if (messages.length === 0) {
    throw new Error("Cannot summarize an empty conversation");
  }

  // Format messages as a readable transcript for the summarizer
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Student" : "Sage"}: ${m.content}`)
    .join("\n\n");

  const summary = await generateResponse(apiKey, SUMMARY_SYSTEM_PROMPT, [
    { role: "user", content: `Please summarize this coaching conversation:\n\n${transcript}` },
  ]);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { summary },
  });

  logger.info("Conversation summarized", { conversationId, summaryLength: summary.length });

  return summary;
}
