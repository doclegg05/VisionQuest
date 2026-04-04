import { prisma } from "@/lib/db";
import type { AIProvider } from "@/lib/ai";
import { logger } from "@/lib/logger";

const EXTRACTION_PROMPT = `Analyze this coaching conversation and extract any self-reported mood or motivation scores the student gave on a 1-10 scale. Look for phrases like "I'd say a 7", "maybe like a 3 out of 10", "I'm feeling about a 5", or similar scaling responses.

Return JSON only: { "scores": [{ "score": <number 1-10>, "context": "<what they were rating>" }] }
If no scores found, return: { "scores": [] }`;

interface ExtractedScore {
  score: number;
  context: string;
}

interface ExtractionResult {
  scores: ExtractedScore[];
}

export async function extractMoodFromConversation(
  conversationId: string,
  studentId: string,
  messages: { role: "user" | "model"; content: string }[],
  provider: AIProvider
): Promise<void> {
  const recentMessages = messages.slice(-10);
  if (recentMessages.length === 0) {
    return;
  }

  const conversationText = recentMessages
    .map((m) => `${m.role === "user" ? "Student" : "Sage"}: ${m.content}`)
    .join("\n\n");

  let result: ExtractionResult;
  try {
    const raw = await provider.generateResponse(EXTRACTION_PROMPT, [
      { role: "user", content: conversationText },
    ]);

    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    const parsed: unknown = JSON.parse(cleaned);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("scores" in parsed) ||
      !Array.isArray((parsed as Record<string, unknown>).scores)
    ) {
      logger.error("Mood extraction: unexpected response shape", { raw });
      return;
    }

    result = parsed as ExtractionResult;
  } catch (err) {
    logger.error("Mood extraction: failed to parse Gemini response", {
      error: String(err),
    });
    return;
  }

  for (const item of result.scores) {
    const score = Math.round(item.score);
    if (!Number.isFinite(score) || score < 1 || score > 10) {
      continue;
    }

    try {
      await prisma.moodEntry.create({
        data: {
          studentId,
          score,
          context: item.context?.trim() || null,
          source: "sage_scaling",
          conversationId,
        },
      });
    } catch (err) {
      logger.error("Mood extraction: failed to save MoodEntry", {
        studentId,
        score,
        error: String(err),
      });
    }
  }
}
