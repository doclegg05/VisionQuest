import { getPlainConfigValue } from "@/lib/system-config";
import type {
  AiTask,
  AIProviderRequest,
  DataSensitivity,
  LocalTaskClass,
} from "./types";

export const DEFAULT_LOCAL_COACHING_MODEL = "gemma4:12b";
export const DEFAULT_LOCAL_SPEED_MODEL = "qwen3.5:9b";
export const DEFAULT_LOCAL_QUALITY_MODEL = "gemma4:26b";

export type LocalModelTier = "speed" | "default" | "quality";

export interface LocalTaskRoutingConfig {
  enabled: boolean;
  defaultModel: string;
  defaultAvailable: boolean;
  speedModel: string;
  speedAvailable: boolean;
  qualityModel: string;
  qualityAvailable: boolean;
}

export interface LocalModelDecision {
  taskClass: LocalTaskClass;
  requestedTier: LocalModelTier;
  selectedTier: LocalModelTier;
  model: string;
  fallback: "none" | "speed_to_default" | "quality_to_default";
}

const PROTECTED_SENSITIVITIES = new Set<DataSensitivity>([
  "student_record",
  "staff_entered",
]);

const QUALITY_CLASSES = new Set<LocalTaskClass>([
  "structured_extraction",
  "rag_grounded_answer",
  "staff_workflow",
  "complex_structured",
]);

const SAFE_CASUAL_PATTERNS = [
  /^tell me (?:a|another) joke[.!?]*$/i,
  /^share (?:a|another) fun fact[.!?]*$/i,
  /^say something funny[.!?]*$/i,
  /^let'?s (?:just )?chat[.!?]*$/i,
  /^how are you(?: doing)?[.!?]*$/i,
  /^what(?:'s| is) your favorite (?:color|animal|food|movie|song|season)[.!?]*$/i,
] as const;

const CRISIS_OR_SAFETY_PATTERN =
  /\b(?:suicid(?:e|al)|kill myself|hurt myself|self[- ]harm|overdose|abuse|unsafe|danger|emergency|crisis|988)\b/i;
const SENSITIVE_COACHING_PATTERN =
  /\b(?:health|medical|mental health|housing|homeless|food|benefits|snap|tanf|caseworker|court|legal|debt|money|family|childcare|violence|trauma|stress|anxiety|depress(?:ed|ion))\b/i;
const GROUNDED_WORK_PATTERN =
  /\b(?:program|policy|handbook|form|application|orientation|certification|credential|classroom|schedule|resource|requirement)\b/i;
const UNCERTAIN_PATTERN =
  /(?:ignore (?:all |the )?(?:previous|system) instructions|system prompt|developer message|<\w+>|```)/i;

function configuredModel(raw: string | null, fallback: string): string {
  const value = raw?.trim();
  return value && value.length <= 100 ? value : fallback;
}

function isGemmaModel(model: string): boolean {
  return /gemma/i.test(model);
}

function isQwenModel(model: string): boolean {
  return /qwen/i.test(model);
}

function enabled(raw: string | null): boolean {
  return raw?.trim().toLowerCase() === "true";
}

export function isProtectedSensitivity(
  sensitivity: DataSensitivity,
): boolean {
  return PROTECTED_SENSITIVITIES.has(sensitivity);
}

export async function readLocalTaskRoutingConfig(): Promise<LocalTaskRoutingConfig> {
  const [
    routingEnabled,
    defaultModel,
    defaultAvailable,
    speedModel,
    speedAvailable,
    qualityModel,
    qualityAvailable,
  ] = await Promise.all([
    getPlainConfigValue("ai_local_task_routing_enabled"),
    getPlainConfigValue("ai_local_model_default"),
    getPlainConfigValue("ai_local_model_default_available"),
    getPlainConfigValue("ai_local_model_speed"),
    getPlainConfigValue("ai_local_model_speed_available"),
    getPlainConfigValue("ai_local_model_quality"),
    getPlainConfigValue("ai_local_model_quality_available"),
  ]);

  return {
    enabled: enabled(routingEnabled),
    defaultModel: configuredModel(
      defaultModel,
      DEFAULT_LOCAL_COACHING_MODEL,
    ),
    defaultAvailable: enabled(defaultAvailable),
    speedModel: configuredModel(speedModel, DEFAULT_LOCAL_SPEED_MODEL),
    speedAvailable: enabled(speedAvailable),
    qualityModel: configuredModel(qualityModel, DEFAULT_LOCAL_QUALITY_MODEL),
    qualityAvailable: enabled(qualityAvailable),
  };
}

export async function isLocalTaskRoutingEnabled(): Promise<boolean> {
  return enabled(await getPlainConfigValue("ai_local_task_routing_enabled"));
}

/**
 * Classify student chat without an LLM. Only a narrow, exact allowlist can
 * reach casual_chat. Everything ambiguous stays on a Gemma path.
 */
export function classifyStudentChatTask(input: {
  message: string;
  hasAttachments?: boolean;
  /** True only when the caller's existing policy will not add RAG/memory. */
  groundingSkipped?: boolean;
}): LocalTaskClass {
  const message = input.message.trim();

  if (input.hasAttachments) return "structured_extraction";
  if (!message || message.length > 160 || message.includes("\n")) {
    return "uncertain";
  }
  if (CRISIS_OR_SAFETY_PATTERN.test(message)) return "crisis_safety";
  if (UNCERTAIN_PATTERN.test(message)) return "uncertain";
  if (SENSITIVE_COACHING_PATTERN.test(message)) return "sensitive_coaching";
  if (GROUNDED_WORK_PATTERN.test(message)) return "rag_grounded_answer";
  if (
    input.groundingSkipped &&
    SAFE_CASUAL_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return "casual_chat";
  }
  return "student_coaching";
}

export function defaultTaskClass(task: AiTask): LocalTaskClass {
  switch (task) {
    case "sage_student_chat":
      return "student_coaching";
    case "sage_staff_chat":
      return "staff_workflow";
    case "sage_post_response":
    case "conversation_summary":
    case "resume_extract":
    case "chat_file_gist":
      return "structured_extraction";
    case "sage_briefing":
    case "public_form_lookup":
    case "public_program_help":
      return "rag_grounded_answer";
    case "resume_assist":
    case "tailor_application":
      return "complex_structured";
    case "legacy":
      return "uncertain";
  }
}

function effectiveTaskClass(request: AIProviderRequest): LocalTaskClass {
  if (
    request.task === "sage_student_chat" &&
    request.localTaskClass
  ) {
    return request.localTaskClass;
  }
  return defaultTaskClass(request.task);
}

function requestedTier(
  request: AIProviderRequest,
  taskClass: LocalTaskClass,
): LocalModelTier {
  const context = request.localRoutingContext;
  const speedEligible =
    request.task === "sage_student_chat" &&
    request.sensitivity === "student_record" &&
    request.localPayloadSensitivity === "deidentified" &&
    taskClass === "casual_chat" &&
    context?.newConversation === true &&
    context.hasHistory === false &&
    context.hasRag === false &&
    context.hasAttachments === false &&
    context.hasCrisisState === false &&
    context.hasStaffContext === false &&
    context.classificationCertain === true &&
    context.minimalContext === true;

  if (speedEligible) return "speed";
  if (QUALITY_CLASSES.has(taskClass)) return "quality";
  return "default";
}

/**
 * Select a configured local model. The default Gemma model is the required
 * safety floor. Optional models can fall back only to that Gemma model, never
 * to Qwen or a cloud provider.
 */
export function selectLocalModel(
  request: AIProviderRequest,
  config: LocalTaskRoutingConfig,
): LocalModelDecision {
  if (!config.enabled) {
    throw new Error("Local task routing is not enabled.");
  }
  if (!config.defaultAvailable) {
    throw new Error(
      "Local task routing is enabled, but the default Gemma model is not marked available.",
    );
  }
  if (!isGemmaModel(config.defaultModel)) {
    throw new Error(
      "Local task routing is enabled, but the default model is not configured as a Gemma model.",
    );
  }

  const taskClass = effectiveTaskClass(request);
  const tier = requestedTier(request, taskClass);

  if (
    tier === "speed" &&
    config.speedAvailable &&
    isQwenModel(config.speedModel)
  ) {
    return {
      taskClass,
      requestedTier: tier,
      selectedTier: "speed",
      model: config.speedModel,
      fallback: "none",
    };
  }
  if (
    tier === "quality" &&
    config.qualityAvailable &&
    isGemmaModel(config.qualityModel)
  ) {
    return {
      taskClass,
      requestedTier: tier,
      selectedTier: "quality",
      model: config.qualityModel,
      fallback: "none",
    };
  }

  return {
    taskClass,
    requestedTier: tier,
    selectedTier: "default",
    model: config.defaultModel,
    fallback:
      tier === "speed"
        ? "speed_to_default"
        : tier === "quality"
          ? "quality_to_default"
          : "none",
  };
}
