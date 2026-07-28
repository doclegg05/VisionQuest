/**
 * Extract Career & Education Plan signals from a career_planning conversation.
 * Mirrors discovery-extractor.ts — proposals require instructor confirmation.
 */
import type { AIProvider } from "@/lib/ai";
import { logger } from "@/lib/logger";

const PLAN_EXTRACTION_PROMPT = `You analyze conversations between Sage (an AI mentor) and a student building a Career & Education Plan in the SPOKES workforce program.

SPOKES mission: help the student earn a job OR transfer to post-secondary education using LMS/certifications (portfolio) and WIOA referrals only.

Extract ONLY what the student clearly expressed or agreed with. Do not invent assessment scores.

Return valid JSON:
{
  "terminal_outcome": "employment" | "post_secondary" | "both" | null,
  "target_clusters": ["SPOKES or national cluster names the student agreed to"],
  "target_industries": ["industries or job families named"],
  "onet_codes": ["O*NET codes if explicitly mentioned, else empty"],
  "assessment_results": {
    "tabe": "summary or null",
    "cfwv": "summary or null",
    "onet_or_cos": "summary or null",
    "other": "summary or null"
  },
  "ecp_status": "not_started" | "in_progress" | "submitted" | "filed",
  "summary": "2-4 sentence instructor-facing plan summary",
  "needs_wioa_referral": true | false,
  "wioa_reason": "why SPOKES resources are not enough, or empty",
  "stage_complete": true | false
}

Rules:
- terminal_outcome must map to job and/or post-secondary. If unclear, leave null and stage_complete false.
- stage_complete true ONLY when the student clearly agreed to a draft plan with a terminal outcome and at least one cluster or industry direction.
- needs_wioa_referral true when the student needs training/funding SPOKES cannot provide with LMS/certs/portfolio alone.
- If not enough information, return empty arrays, null outcome, stage_complete false.`;

export type TerminalOutcome = "employment" | "post_secondary" | "both";

export interface PlanAssessmentResults {
  tabe: string | null;
  cfwv: string | null;
  onet_or_cos: string | null;
  other: string | null;
}

export interface CareerPlanExtraction {
  terminal_outcome: TerminalOutcome | null;
  target_clusters: string[];
  target_industries: string[];
  onet_codes: string[];
  assessment_results: PlanAssessmentResults;
  ecp_status: "not_started" | "in_progress" | "submitted" | "filed";
  summary: string;
  needs_wioa_referral: boolean;
  wioa_reason: string;
  stage_complete: boolean;
}

const EMPTY: CareerPlanExtraction = {
  terminal_outcome: null,
  target_clusters: [],
  target_industries: [],
  onet_codes: [],
  assessment_results: { tabe: null, cfwv: null, onet_or_cos: null, other: null },
  ecp_status: "not_started",
  summary: "",
  needs_wioa_referral: false,
  wioa_reason: "",
  stage_complete: false,
};

const OUTCOMES = new Set<TerminalOutcome>(["employment", "post_secondary", "both"]);
const ECP_STATUSES = new Set(["not_started", "in_progress", "submitted", "filed"]);

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, 12);
}

function asNullableString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length ? t : null;
}

export function validateCareerPlanExtraction(raw: unknown): CareerPlanExtraction {
  if (!raw || typeof raw !== "object") return EMPTY;
  const obj = raw as Record<string, unknown>;
  const outcomeRaw = obj.terminal_outcome;
  const terminal_outcome =
    typeof outcomeRaw === "string" && OUTCOMES.has(outcomeRaw as TerminalOutcome)
      ? (outcomeRaw as TerminalOutcome)
      : null;
  const ecpRaw = typeof obj.ecp_status === "string" ? obj.ecp_status : "not_started";
  const assessments =
    obj.assessment_results && typeof obj.assessment_results === "object"
      ? (obj.assessment_results as Record<string, unknown>)
      : {};
  return {
    terminal_outcome,
    target_clusters: asStringArray(obj.target_clusters),
    target_industries: asStringArray(obj.target_industries),
    onet_codes: asStringArray(obj.onet_codes),
    assessment_results: {
      tabe: asNullableString(assessments.tabe),
      cfwv: asNullableString(assessments.cfwv),
      onet_or_cos: asNullableString(assessments.onet_or_cos),
      other: asNullableString(assessments.other),
    },
    ecp_status: (ECP_STATUSES.has(ecpRaw) ? ecpRaw : "not_started") as CareerPlanExtraction["ecp_status"],
    summary: typeof obj.summary === "string" ? obj.summary.trim().slice(0, 2000) : "",
    needs_wioa_referral: obj.needs_wioa_referral === true,
    wioa_reason: typeof obj.wioa_reason === "string" ? obj.wioa_reason.trim().slice(0, 500) : "",
    stage_complete: obj.stage_complete === true && terminal_outcome !== null,
  };
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function extractCareerPlanSignals(
  provider: AIProvider,
  conversationText: string,
): Promise<CareerPlanExtraction> {
  try {
    const result = await provider.generateStructuredResponse(
      PLAN_EXTRACTION_PROMPT,
      [{ role: "user", content: conversationText }],
    );
    const parsed = extractJsonObject(result);
    return validateCareerPlanExtraction(parsed);
  } catch (err) {
    logger.error("career plan extraction failed", { error: String(err) });
    return EMPTY;
  }
}
