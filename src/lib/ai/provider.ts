import { getPlainConfigValue } from "@/lib/system-config";
import { resolveApiKey } from "@/lib/chat/api-key";
import { isSafeAiProviderUrl } from "@/lib/validation";
import {
  DEFAULT_OLLAMA_MODEL,
  readLocalAiProviderConfig,
  toLocalAiAuthConfig,
} from "./local-config";
import { OllamaProvider } from "./ollama-provider";
import { GeminiProvider } from "./gemini-provider";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderType,
  AiTask,
  DataSensitivity,
  PromptTier,
} from "./types";

async function getConfiguredProviderType(): Promise<AIProviderType> {
  const providerType = await getPlainConfigValue("ai_provider");
  return providerType === "local" ? "local" : "cloud";
}

async function getCloudProvider(studentId: string): Promise<AIProvider> {
  const apiKey = await resolveApiKey(studentId);
  return new GeminiProvider(apiKey);
}

// Bounds for the Ollama num_ctx override. 1024 is the floor for any
// useful conversation; 131072 matches the largest context window
// supported by current open-weights models (Llama 3.x, Qwen 2.5).
const NUM_CTX_MIN = 1024;
const NUM_CTX_MAX = 131072;

function parseNumCtxOverride(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < NUM_CTX_MIN || parsed > NUM_CTX_MAX) return undefined;
  return parsed;
}

async function getLocalProvider(): Promise<AIProvider> {
  const config = await readLocalAiProviderConfig();
  if (!config.url) {
    throw new Error(
      "Local AI server URL is not configured. Set it in Program Setup > AI Provider.",
    );
  }
  if (!isSafeAiProviderUrl(config.url)) {
    throw new Error(
      "Local AI server URL is invalid. Use localhost/127.0.0.1/::1 or a public http/https endpoint.",
    );
  }
  return new OllamaProvider(
    config.url,
    config.model || DEFAULT_OLLAMA_MODEL,
    toLocalAiAuthConfig(config, {
      numCtx: parseNumCtxOverride(config.numCtxRaw),
    }),
  );
}

function isLocalOnlySensitivity(sensitivity: DataSensitivity): boolean {
  return sensitivity === "student_record" || sensitivity === "staff_entered";
}

/**
 * Tasks that submit whole documents of student PII to a model — resume text
 * (name, address, phone, employment history) and uploaded file contents.
 * These HARD-GATE to the local provider: if no local server is configured the
 * resolver throws and the caller returns 503, rather than falling through to
 * cloud (VQ-R-002/VQ-R-003, owner decision 2026-07-24 "fail closed for uploads
 * only").
 *
 * Gating keys off task, not sensitivity, deliberately: sage_staff_chat carries
 * `staff_entered`, so a sensitivity-based gate would take staff chat offline
 * whenever the local server was down. The decision explicitly kept chat
 * always-available on cloud with consent + audit, and narrowed the hard gate to
 * these document paths.
 *
 * Adding a task here is a deliberate act. Anything not listed keeps the
 * pre-existing configured-provider behavior.
 */
export const DOCUMENT_LOCAL_ONLY_TASKS: ReadonlySet<AiTask> = new Set([
  "resume_extract",
  "resume_assist",
  "tailor_application",
  "chat_file_gist",
]);

function isDocumentLocalOnlyTask(task: AiTask): boolean {
  return DOCUMENT_LOCAL_ONLY_TASKS.has(task);
}

/**
 * Resolve the active AI provider based on SystemConfig.
 *
 * - "local" -> OllamaProvider (reads ai_provider_url, ai_provider_model)
 * - "cloud" or unset -> GeminiProvider (uses existing API key resolution)
 *
 * Prefer resolveAiProvider() for new call sites so the task's data
 * sensitivity is explicit.
 */
export async function getProvider(studentId: string): Promise<AIProvider> {
  const providerType = await getConfiguredProviderType();
  return providerType === "local"
    ? getLocalProvider()
    : getCloudProvider(studentId);
}

/**
 * Resolve a provider for a specific task.
 *
 * Two tiers, per the owner's 2026-07-24 data-residency decision:
 *
 * 1. DOCUMENT_LOCAL_ONLY_TASKS (resume text, uploaded file contents) hard-gate
 *    to the local provider and THROW when none is configured. Callers surface
 *    that as a 503 with an honest "offline until the local AI server is
 *    available" message. No cloud fallback, no silent downgrade.
 * 2. Everything else — chat, post-response extraction, briefings, summaries —
 *    routes to the configured provider. Student-record chat may run on cloud so
 *    a local outage never takes the product down; every request is recorded in
 *    the AI audit log, and the AI data-consent form is the basis.
 *
 * Before this split, tier 1 did not exist: student_record routed to local only
 * when `ai_provider === "local"`, and an unset row defaults to "cloud" — so a
 * fresh or wiped config sent full resume text to Gemini while CLAUDE.md claimed
 * local-only was enforced. The docs now describe exactly this behavior.
 */
export async function resolveAiProvider(
  request: AIProviderRequest,
): Promise<AIProvider> {
  if (isDocumentLocalOnlyTask(request.task)) {
    // Throws when the local server is unconfigured or its URL is unsafe —
    // getLocalProvider()'s messages already name Program Setup > AI Provider.
    return getLocalProvider();
  }

  if (isLocalOnlySensitivity(request.sensitivity)) {
    const providerType = await getConfiguredProviderType();
    if (providerType === "local") {
      return getLocalProvider();
    }
    return getCloudProvider(request.studentId);
  }

  if (request.preferCloud && request.sensitivity === "public_program") {
    return getCloudProvider(request.studentId);
  }

  return getProvider(request.studentId);
}

export function getPromptTier(provider: AIProvider): PromptTier {
  return provider.name === "ollama" ? "compact" : "full";
}
