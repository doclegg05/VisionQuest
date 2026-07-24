export type ConversationStage =
  | "discovery"
  | "career_planning"
  | "onboarding"
  | "bhag"
  | "monthly"
  | "weekly"
  | "daily"
  | "tasks"
  | "checkin"
  | "review"
  | "orientation"
  | "general"
  | "teacher_assistant"
  | "admin_assistant"
  | "coordinator_assistant"
  | "career_profile_review"
  | "job_campaign";

export function determineStage(
  goals: { level: string }[],
  hasCompletedDiscovery?: boolean,
  hasConfirmedCareerPlan?: boolean,
): ConversationStage {
  const levels = new Set(goals.map((g) => g.level));
  // Discovery comes first — any student without a completed discovery
  // and without a BHAG enters discovery mode
  if (hasCompletedDiscovery !== true && !levels.has("bhag")) return "discovery";
  // After discovery, build a Career & Education Plan before the BHAG ladder
  // unless a BHAG already exists (legacy / instructor-seeded path).
  if (
    hasCompletedDiscovery === true &&
    hasConfirmedCareerPlan !== true &&
    !levels.has("bhag")
  ) {
    return "career_planning";
  }
  if (!levels.has("bhag")) return "onboarding";
  if (!levels.has("monthly")) return "monthly";
  if (!levels.has("weekly")) return "weekly";
  if (!levels.has("daily")) return "daily";
  if (!levels.has("task")) return "tasks";
  return "checkin";
}

/**
 * Stages where the long counseling script can drown out a logistics ask.
 * Per-turn prompt override only — does not change the stored conversation stage.
 */
const LOGISTICS_OVERRIDE_STAGES = new Set<ConversationStage>([
  "discovery",
  "career_planning",
  "onboarding",
  "bhag",
  "monthly",
  "weekly",
  "daily",
  "tasks",
  "job_campaign",
]);

/** Tool-mapped platform logistics (forms, certs, appointments, portfolio, jobs). */
const LOGISTICS_INTENT_PATTERN =
  /\b(form|forms|document|documents|pdf|packet|paperwork|download|fill(?:able| out| in)?|orientation|onboarding|profile|attendance|contract|release|dress code|checklist|cert(?:ification)?s?|credential|appointment|schedule|book|advisor|advising|check[- ]?in|portfolio|resume|job(?:s)?|cover letter|interview)\b/i;

/**
 * True when the student message looks like a platform logistics / tool ask
 * rather than open-ended goal or discovery talk.
 */
export function messageHasLogisticsIntent(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return LOGISTICS_INTENT_PATTERN.test(trimmed);
}

/**
 * Per-turn prompt stage: when the stored stage is a counseling ladder but the
 * student asked for logistics, use orientation (forms/paperwork) or general
 * (other tool-mapped asks) so discovery/onboarding scripts don't dominate.
 * Stored conversation.stage is unchanged.
 */
export function promptStageForMessage(
  storedStage: ConversationStage,
  userMessage: string,
  options?: { hasFormMatch?: boolean },
): ConversationStage {
  if (!LOGISTICS_OVERRIDE_STAGES.has(storedStage)) return storedStage;
  if (!messageHasLogisticsIntent(userMessage) && !options?.hasFormMatch) {
    return storedStage;
  }
  // Form/paperwork → orientation tour; other logistics → general act-then-coach.
  if (
    options?.hasFormMatch ||
    /\b(form|forms|document|documents|pdf|packet|paperwork|fill(?:able| out| in)?|orientation|profile|attendance|contract|release|dress code|checklist)\b/i.test(
      userMessage,
    )
  ) {
    return "orientation";
  }
  return "general";
}
