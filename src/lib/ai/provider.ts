import { getPlainConfigValue } from "@/lib/system-config";
import { resolveApiKey } from "@/lib/chat/api-key";
import { isSafeAiProviderUrl } from "@/lib/validation";
import {
  DEFAULT_OLLAMA_MODEL,
  readLocalAiProviderConfig,
  readLocalAiRoleMaxOutputTokensRaw,
  readLocalAiRoleModel,
  toLocalAiAuthConfig,
} from "./local-config";
import { isSameModelTag, roleForTask, type AiRole } from "./roles";
import { OllamaProvider } from "./ollama-provider";
import { GeminiProvider } from "./gemini-provider";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderType,
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

// Bounds for the output-token cap. 128 is the floor for a usable coaching
// reply; the ceiling stays under the smallest supported num_ctx so the cap
// can never squeeze out the prompt itself.
const MAX_OUTPUT_TOKENS_MIN = 128;
const MAX_OUTPUT_TOKENS_MAX = 32768;

function parseMaxOutputTokensOverride(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < MAX_OUTPUT_TOKENS_MIN || parsed > MAX_OUTPUT_TOKENS_MAX) return undefined;
  return parsed;
}

/**
 * Reasoning is OFF unless explicitly enabled: on a thinking model the
 * reasoning channel draws from the same output budget as the reply and can
 * consume all of it, leaving the caller with nothing.
 */
function parseReasoningOverride(raw: string | null): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "on" || normalized === "true" || normalized === "1";
}

/**
 * Resolve the local model for `role` and decide how long it may stay resident.
 *
 * Two rules, both fail-safe:
 *  - An unset role override falls back to `ai_provider_model`, so a role
 *    nobody has tuned behaves exactly as it did before roles existed.
 *  - Only the model serving interactive chat gets the workday-length
 *    keep-alive. Any role resolving to a *different* model is background
 *    weight and gets the short one, so it cannot hold unified memory against
 *    the model students are waiting on. A role that resolves to the same
 *    model as chat shares chat's residency and keeps the long keep-alive —
 *    the single-model deployment is unchanged in every respect.
 */
async function resolveLocalModelForRole(
  role: AiRole | null,
  globalModel: string,
): Promise<{ model: string; keepAlive?: string; maxOutputTokens?: number }> {
  if (!role) return { model: globalModel };

  const [roleModel, roleMaxOutputRaw] = await Promise.all([
    readLocalAiRoleModel(role),
    readLocalAiRoleMaxOutputTokensRaw(role),
  ]);
  const model = roleModel?.trim() || globalModel;
  // Bounded by the same parser the global cap uses, so an out-of-range or
  // non-numeric role value falls back to the global cap rather than throwing.
  const maxOutputTokens = parseMaxOutputTokensOverride(roleMaxOutputRaw);

  if (role === "chat") return { model, maxOutputTokens };

  const chatModel = (await readLocalAiRoleModel("chat"))?.trim() || globalModel;
  // Tag equality is not string equality: Ollama resolves a bare name to its
  // `:latest` tag, and keep_alive is applied by the server per MODEL. Treating
  // an alias of the chat model as "different" would attach the short
  // keep-alive to the model students are waiting on.
  return isSameModelTag(model, chatModel)
    ? { model, maxOutputTokens }
    : { model, maxOutputTokens, keepAlive: OllamaProvider.SECONDARY_KEEP_ALIVE };
}

async function getLocalProvider(role: AiRole | null = null): Promise<AIProvider> {
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
  const { model, keepAlive, maxOutputTokens } = await resolveLocalModelForRole(
    role,
    config.model || DEFAULT_OLLAMA_MODEL,
  );
  return new OllamaProvider(
    config.url,
    model,
    toLocalAiAuthConfig(config, {
      numCtx: parseNumCtxOverride(config.numCtxRaw),
      reasoning: parseReasoningOverride(config.reasoningRaw),
      maxOutputTokens:
        maxOutputTokens ?? parseMaxOutputTokensOverride(config.maxOutputTokensRaw),
      // Role-derived only — see LocalAIAuthConfig.structuredMaxOutputTokens
      // for why the global cap deliberately does not reach JSON mode.
      structuredMaxOutputTokens: maxOutputTokens,
      keepAlive,
    }),
  );
}

function isLocalOnlySensitivity(sensitivity: DataSensitivity): boolean {
  return sensitivity === "student_record" || sensitivity === "staff_entered";
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
export async function getProvider(
  studentId: string,
  role: AiRole | null = null,
): Promise<AIProvider> {
  const providerType = await getConfiguredProviderType();
  return providerType === "local"
    ? getLocalProvider(role)
    : getCloudProvider(studentId);
}

/**
 * Resolve a provider for a specific task. Student-record and staff-entered
 * prompts are FERPA-sensitive and route to a local model when one is
 * configured (`ai_provider = "local"`). During alpha/pre-hardware testing
 * the operator can flip `ai_provider = "cloud"` to honor the configured
 * cloud provider for these prompts too — every request is still recorded
 * in the AI audit log so the data path remains auditable.
 */
export async function resolveAiProvider(
  request: AIProviderRequest,
): Promise<AIProvider> {
  // The role decides WHICH local model serves the call; sensitivity still
  // decides WHETHER a local model serves it at all. Roles never widen the
  // FERPA routing rule below, and the cloud provider ignores roles entirely
  // (Gemini is one model for every job).
  const role = request.role ?? roleForTask(request.task);

  if (isLocalOnlySensitivity(request.sensitivity)) {
    const providerType = await getConfiguredProviderType();
    if (providerType === "local") {
      return getLocalProvider(role);
    }
    return getCloudProvider(request.studentId);
  }

  if (request.preferCloud && request.sensitivity === "public_program") {
    return getCloudProvider(request.studentId);
  }

  return getProvider(request.studentId, role);
}

export function getPromptTier(provider: AIProvider): PromptTier {
  return provider.name === "ollama" ? "compact" : "full";
}
