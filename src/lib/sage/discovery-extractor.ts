import { generateStructuredResponse } from "../gemini";
import { logger } from "@/lib/logger";
import { CAREER_CLUSTERS } from "@/lib/spokes/career-clusters";
import { NATIONAL_CAREER_CLUSTERS } from "@/lib/spokes/national-clusters";

const clusterIds = CAREER_CLUSTERS.map((c) => `"${c.id}"`).join(", ");

const DISCOVERY_EXTRACTION_PROMPT = `You analyze conversations between Sage (an AI mentor) and a student in a career discovery phase of a workforce development program.

Extract career assessment signals from the conversation. Only extract signals the student has clearly expressed or agreed with — do not invent signals they haven't shared.

Return valid JSON in this exact format:
{
  "interests": ["string array of expressed work/career interests"],
  "strengths": ["string array of expressed strengths or skills"],
  "subjects": ["string array of preferred learning areas (numbers, writing, computers, hands-on, people, etc.)"],
  "problems": ["string array of real-world problems or causes the student cares about"],
  "values": ["string array of expressed job/life values"],
  "circumstances": ["string array of life circumstances (schedule, transport, childcare, language, etc.)"],
  "cluster_scores": {
    ${CAREER_CLUSTERS.map((c) => `"${c.id}": 0.0`).join(",\n    ")}
  },
  "summary": "1-2 sentence summary for the instructor",

  "riasec_scores": {
    "realistic": 0.0,
    "investigative": 0.0,
    "artistic": 0.0,
    "social": 0.0,
    "enterprising": 0.0,
    "conventional": 0.0
  },

  "national_career_clusters": [
    {
      "cluster_name": "one of the 16 national career clusters",
      "score": 0.0,
      "spokes_mapping": ["matching SPOKES cluster IDs"]
    }
  ],

  "transferable_skills": [
    {
      "skill": "name of the skill",
      "category": "communication | organization | technical | interpersonal | analytical | leadership",
      "evidence": "brief quote or paraphrase of what the student said that demonstrates this skill"
    }
  ],

  "work_values": [
    {
      "value": "name of the value",
      "importance": "high | medium | low"
    }
  ],

  "assessment_summary": "3-5 sentence instructor-facing summary covering: Holland interest profile, key transferable skills, work values, and recommended career direction. Written as if you are a job coach reporting to a case manager.",

  "stage_complete": true | false,
  "xp_events": []
}

RIASEC SCORING GUIDE:
Score each Holland dimension 0.0 to 1.0 based on conversational evidence:
- realistic: hands-on, mechanical, outdoor, practical, tool-using, building, fixing
- investigative: analytical, curious, research-oriented, problem-solving, figuring things out
- artistic: creative, expressive, original, independent, design-oriented, crafty
- social: helping, teaching, mentoring, teamwork, empathetic, caring for others
- enterprising: leading, persuading, managing, risk-taking, ambitious, selling
- conventional: organizing, detail-oriented, systematic, data-focused, following procedures

NATIONAL CAREER CLUSTERS:
Score relevance to these 16 clusters (include ONLY those scoring >= 0.3):
${NATIONAL_CAREER_CLUSTERS.join(", ")}

TRANSFERABLE SKILLS:
Extract skills demonstrated through life experience, prior work, hobbies, household management, or education. Each skill MUST have evidence from the conversation — do not infer skills without evidence.
Categories: communication, organization, technical, interpersonal, analytical, leadership

WORK VALUES:
Extract what matters to the student in a job. Rate importance as high/medium/low.
Common values: stability, creativity, independence, helping-others, income, growth, work-life-balance, teamwork, variety, recognition, security, flexibility

Rules:
- cluster_scores: score each SPOKES pathway 0.0 to 1.0 based on fit
- Valid SPOKES cluster IDs: ${clusterIds}
- stage_complete: true ONLY when the student has clearly confirmed or agreed to a career direction
- A student immediately saying "I want to work in [specific field]" counts as stage_complete
- stage_complete is false if the student is still exploring or hasn't confirmed
- xp_events can include: "discovery_complete" (only when stage_complete is true)
- If not enough information yet, return empty arrays, zero scores, and stage_complete: false
- For riasec_scores: only score dimensions where the student has provided evidence; leave others at 0.0
- For transferable_skills: only include skills with clear conversational evidence
- For national_career_clusters: only include clusters scoring >= 0.3`;

export interface RiasecScores {
  realistic: number;
  investigative: number;
  artistic: number;
  social: number;
  enterprising: number;
  conventional: number;
}

export interface NationalClusterScore {
  cluster_name: string;
  score: number;
  spokes_mapping: string[];
}

export interface TransferableSkill {
  skill: string;
  category: string;
  evidence: string;
}

export interface WorkValue {
  value: string;
  importance: "high" | "medium" | "low";
}

export interface DiscoveryResult {
  // Existing fields
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

  // Assessment fields
  riasec_scores: RiasecScores;
  holland_code: string;
  national_career_clusters: NationalClusterScore[];
  transferable_skills: TransferableSkill[];
  work_values: WorkValue[];
  assessment_summary: string;
}

const EMPTY_RIASEC: RiasecScores = {
  realistic: 0,
  investigative: 0,
  artistic: 0,
  social: 0,
  enterprising: 0,
  conventional: 0,
};

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
  riasec_scores: EMPTY_RIASEC,
  holland_code: "",
  national_career_clusters: [],
  transferable_skills: [],
  work_values: [],
  assessment_summary: "",
};

const RIASEC_KEYS: (keyof RiasecScores)[] = [
  "realistic",
  "investigative",
  "artistic",
  "social",
  "enterprising",
  "conventional",
];

function computeHollandCode(scores: RiasecScores): string {
  return RIASEC_KEYS
    .filter((k) => scores[k] > 0)
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, 3)
    .map((k) => k[0].toUpperCase())
    .join("");
}

function clampScore(val: unknown): number {
  if (typeof val !== "number" || Number.isNaN(val)) return 0;
  return Math.min(1, Math.max(0, val));
}

function validateRiasec(raw: unknown): RiasecScores {
  if (!raw || typeof raw !== "object") return EMPTY_RIASEC;
  const obj = raw as Record<string, unknown>;
  return {
    realistic: clampScore(obj.realistic),
    investigative: clampScore(obj.investigative),
    artistic: clampScore(obj.artistic),
    social: clampScore(obj.social),
    enterprising: clampScore(obj.enterprising),
    conventional: clampScore(obj.conventional),
  };
}

function validateNationalClusters(raw: unknown): NationalClusterScore[] {
  if (!Array.isArray(raw)) return [];
  const validNames = new Set(NATIONAL_CAREER_CLUSTERS);
  return raw
    .filter(
      (item): item is { cluster_name: string; score: number; spokes_mapping: string[] } =>
        item &&
        typeof item === "object" &&
        typeof item.cluster_name === "string" &&
        validNames.has(item.cluster_name as typeof NATIONAL_CAREER_CLUSTERS[number]) &&
        typeof item.score === "number",
    )
    .map((item) => ({
      cluster_name: item.cluster_name,
      score: clampScore(item.score),
      spokes_mapping: Array.isArray(item.spokes_mapping) ? item.spokes_mapping : [],
    }))
    .filter((item) => item.score >= 0.3);
}

function validateTransferableSkills(raw: unknown): TransferableSkill[] {
  if (!Array.isArray(raw)) return [];
  const validCategories = new Set([
    "communication",
    "organization",
    "technical",
    "interpersonal",
    "analytical",
    "leadership",
  ]);
  return raw
    .filter(
      (item): item is TransferableSkill =>
        item &&
        typeof item === "object" &&
        typeof item.skill === "string" &&
        typeof item.category === "string" &&
        typeof item.evidence === "string",
    )
    .map((item) => ({
      skill: item.skill,
      category: validCategories.has(item.category) ? item.category : "interpersonal",
      evidence: item.evidence,
    }));
}

function validateWorkValues(raw: unknown): WorkValue[] {
  if (!Array.isArray(raw)) return [];
  const validImportance = new Set(["high", "medium", "low"]);
  return raw
    .filter(
      (item): item is WorkValue =>
        item &&
        typeof item === "object" &&
        typeof item.value === "string" &&
        typeof item.importance === "string",
    )
    .map((item) => ({
      value: item.value,
      importance: validImportance.has(item.importance)
        ? (item.importance as "high" | "medium" | "low")
        : "medium",
    }));
}

export async function extractDiscoverySignals(
  apiKey: string,
  messages: { role: "user" | "model"; content: string }[],
): Promise<DiscoveryResult> {
  try {
    const recent = messages.slice(-10);

    const contextPrompt = "Analyze the career discovery conversation and extract assessment signals:";
    const messagesWithContext = [
      ...recent,
      { role: "user" as const, content: contextPrompt },
    ];

    const result = await generateStructuredResponse(
      apiKey,
      DISCOVERY_EXTRACTION_PROMPT,
      messagesWithContext,
    );
    const parsed = JSON.parse(result) as Record<string, unknown>;

    // Validate SPOKES cluster_scores
    const validClusterIds = new Set(CAREER_CLUSTERS.map((c) => c.id));
    const cleanedScores: Record<string, number> = {};
    const rawScores = (parsed.cluster_scores || {}) as Record<string, unknown>;
    for (const [key, val] of Object.entries(rawScores)) {
      if (validClusterIds.has(key) && typeof val === "number") {
        cleanedScores[key] = clampScore(val);
      }
    }

    // Validate RIASEC and compute Holland code
    const riasec = validateRiasec(parsed.riasec_scores);
    const hollandCode = computeHollandCode(riasec);

    return {
      interests: Array.isArray(parsed.interests) ? (parsed.interests as string[]) : [],
      strengths: Array.isArray(parsed.strengths) ? (parsed.strengths as string[]) : [],
      subjects: Array.isArray(parsed.subjects) ? (parsed.subjects as string[]) : [],
      problems: Array.isArray(parsed.problems) ? (parsed.problems as string[]) : [],
      values: Array.isArray(parsed.values) ? (parsed.values as string[]) : [],
      circumstances: Array.isArray(parsed.circumstances) ? (parsed.circumstances as string[]) : [],
      cluster_scores: cleanedScores,
      summary: typeof parsed.summary === "string" ? (parsed.summary as string) : "",
      stage_complete: parsed.stage_complete === true,
      xp_events: Array.isArray(parsed.xp_events) ? (parsed.xp_events as string[]) : [],
      riasec_scores: riasec,
      holland_code: hollandCode,
      national_career_clusters: validateNationalClusters(parsed.national_career_clusters),
      transferable_skills: validateTransferableSkills(parsed.transferable_skills),
      work_values: validateWorkValues(parsed.work_values),
      assessment_summary: typeof parsed.assessment_summary === "string"
        ? (parsed.assessment_summary as string)
        : "",
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
