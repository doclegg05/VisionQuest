import { generateStructuredResponse } from "../gemini";
import { logger } from "@/lib/logger";
import { CAREER_CLUSTERS } from "@/lib/spokes/career-clusters";

const clusterIds = CAREER_CLUSTERS.map((c) => `"${c.id}"`).join(", ");

const DISCOVERY_EXTRACTION_PROMPT = `You analyze conversations between Sage (an AI mentor) and a student in a career discovery phase of a workforce development program.

Extract signals about what career direction fits this student. Only extract signals the student has clearly expressed or agreed with — do not invent signals they haven't shared.

Return valid JSON in this exact format:
{
  "interests": ["string array of expressed work/career interests"],
  "strengths": ["string array of expressed strengths or skills"],
  "subjects": ["string array of preferred learning areas or skill types mentioned (numbers, writing, computers, hands-on, people, etc.)"],
  "problems": ["string array of real-world problems or causes the student cares about"],
  "values": ["string array of expressed job/life values"],
  "circumstances": ["string array of life circumstances mentioned (schedule, transport, childcare, language, etc.)"],
  "cluster_scores": {
    ${CAREER_CLUSTERS.map((c) => `"${c.id}": 0.0`).join(",\n    ")}
  },
  "summary": "1-2 sentence summary of what you learned about this student's career direction, written for an instructor",
  "stage_complete": true | false,
  "xp_events": []
}

Rules:
- cluster_scores: score each career pathway 0.0 to 1.0 based on how well it matches the student's expressed interests, strengths, subjects, problems, and values
- Valid cluster IDs: ${clusterIds}
- stage_complete: true ONLY when the student has clearly confirmed or agreed to a career direction or pathway
- A student immediately saying "I want to work in [specific field]" counts as stage_complete if it maps to a cluster
- stage_complete is false if the student is still exploring, unsure, or hasn't confirmed a direction
- summary should be factual and concise, as if reporting to the student's instructor
- xp_events can include: "discovery_complete" (only when stage_complete is true)
- If not enough information yet, return empty arrays and low scores with stage_complete: false`;

export interface DiscoveryResult {
  interests: string[];
  strengths: string[];
  subjects: string[];
  problems: string[];
  values: string[];
  circumstances: string[];
  cluster_scores: Record<string, number>;
  summary: string;
  stage_complete: boolean;
  xp_events: string[];
}

const EMPTY_RESULT: DiscoveryResult = {
  interests: [],
  strengths: [],
  subjects: [],
  problems: [],
  values: [],
  circumstances: [],
  cluster_scores: {},
  summary: "",
  stage_complete: false,
  xp_events: [],
};

export async function extractDiscoverySignals(
  apiKey: string,
  messages: { role: "user" | "model"; content: string }[],
): Promise<DiscoveryResult> {
  try {
    const recent = messages.slice(-10);

    const contextPrompt = "Analyze the career discovery conversation and extract signals:";
    const messagesWithContext = [
      ...recent,
      { role: "user" as const, content: contextPrompt },
    ];

    const result = await generateStructuredResponse(
      apiKey,
      DISCOVERY_EXTRACTION_PROMPT,
      messagesWithContext,
    );
    const parsed = JSON.parse(result) as DiscoveryResult;

    // Validate cluster_scores keys against known clusters
    const validClusterIds = new Set(CAREER_CLUSTERS.map((c) => c.id));
    const cleanedScores: Record<string, number> = {};
    for (const [key, val] of Object.entries(parsed.cluster_scores || {})) {
      if (validClusterIds.has(key) && typeof val === "number") {
        cleanedScores[key] = Math.min(1, Math.max(0, val));
      }
    }

    return {
      interests: Array.isArray(parsed.interests) ? parsed.interests : [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      subjects: Array.isArray(parsed.subjects) ? parsed.subjects : [],
      problems: Array.isArray(parsed.problems) ? parsed.problems : [],
      values: Array.isArray(parsed.values) ? parsed.values : [],
      circumstances: Array.isArray(parsed.circumstances) ? parsed.circumstances : [],
      cluster_scores: cleanedScores,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      stage_complete: parsed.stage_complete === true,
      xp_events: Array.isArray(parsed.xp_events) ? parsed.xp_events : [],
    };
  } catch (error) {
    logger.error("Discovery extraction failed", { error: String(error) });
    return EMPTY_RESULT;
  }
}

/**
 * Get the top N cluster IDs by score, filtering out clusters below a threshold.
 */
export function topClusterIds(
  scores: Record<string, number>,
  count = 2,
  threshold = 0.3,
): string[] {
  return Object.entries(scores)
    .filter(([, score]) => score >= threshold)
    .sort(([, a], [, b]) => b - a)
    .slice(0, count)
    .map(([id]) => id);
}
