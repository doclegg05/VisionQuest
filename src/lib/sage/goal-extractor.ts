import type { AIProvider } from "@/lib/ai";
import { logger } from "@/lib/logger";

const EXTRACTION_PROMPT = `You analyze conversations between Sage (an AI mentor) and a student in a goal-setting program.

Extract any goals the student has committed to. Only extract goals that the student has clearly stated or agreed to — do not invent goals they haven't expressed.

Return valid JSON in this exact format:
{
  "goals_found": [
    {
      "level": "bhag" | "monthly" | "weekly" | "daily" | "task",
      "content": "the goal in the student's own words",
      "confidence": 0.0 to 1.0
    }
  ],
  "stage_complete": true | false
}

Rules:
- "bhag" = Big Hairy Audacious Goal (long-term dream/vision)
- "monthly" = what they'll accomplish this month
- "weekly" = what they'll do this week
- "daily" = most important thing today
- "task" = specific action steps
- confidence must be above 0.7 for the goal to be real — if the student is still brainstorming, confidence should be low
- stage_complete = true only if the student has clearly committed to a goal at the current level
- If no goals are found, return an empty array`;

export interface ExtractedGoal {
  level: string;
  content: string;
  confidence: number;
}

export interface ExtractionResult {
  goals_found: ExtractedGoal[];
  stage_complete: boolean;
}

export async function extractGoals(
  provider: AIProvider,
  messages: { role: "user" | "model"; content: string }[],
  currentStage: string
): Promise<ExtractionResult> {
  try {
    // Use the last 10 messages for context efficiency
    const recent = messages.slice(-10);

    const contextPrompt = `Current goal-setting stage: ${currentStage}\n\nAnalyze the conversation and extract goals:`;
    const messagesWithContext = [
      ...recent,
      { role: "user" as const, content: contextPrompt },
    ];

    const result = await provider.generateStructuredResponse(EXTRACTION_PROMPT, messagesWithContext);
    const parsed = JSON.parse(result);

    // Validate structure before using — Gemini may return malformed JSON
    const goalsFound = Array.isArray(parsed?.goals_found) ? parsed.goals_found : [];
    const validGoals = goalsFound.filter(
      (g: unknown): g is ExtractedGoal =>
        typeof g === "object" && g !== null &&
        typeof (g as ExtractedGoal).level === "string" &&
        typeof (g as ExtractedGoal).content === "string" &&
        typeof (g as ExtractedGoal).confidence === "number" &&
        (g as ExtractedGoal).confidence > 0.7,
    );

    return {
      goals_found: validGoals,
      stage_complete: parsed?.stage_complete === true,
    };
  } catch (error) {
    logger.error("Goal extraction failed", { error: String(error) });
    return { goals_found: [], stage_complete: false };
  }
}
