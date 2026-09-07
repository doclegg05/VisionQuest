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
import { enforceCloudPolicy, isLocalOnlySensitivity } from "./lanes";
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

/**
 * A student's personal Gemini key may serve ONLY public-program prompts. A
 * consumer key is outside any program-level agreement with the vendor, so a
 * student_record or staff_entered prompt sent under it would leave every
 * contractual protection behind (FERPA review, report C2). Those calls use
 * the platform key whatever the student has entered in Settings.
 */
async function getCloudProvider(
  studentId: string,
  sensitivity: DataSensitivity,
): Promise<AIProvider> {
  const apiKey = await resolveApiKey(studentId, {
    allowPersonalKey: !isLocalOnlySensitivity(sensitivity),
  });
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
    : getCloudProvider(studentId, "configured");
}

/**
 * Resolve a provider for a specific task.
 *
 * Two settings decide the outcome, in this order:
 *
 *  1. `ai_provider` decides WHICH provider is configured. `"local"` serves
 *     every call from the local model and never consults the policy below;
 *     `"cloud"` or unset serves every call from Gemini. `preferCloud` lifts a
 *     `public_program` call to Gemini even on a local deployment.
 *  2. `ai_cloud_policy` decides WHETHER a cloud resolution is allowed for
 *     this task and sensitivity (src/lib/ai/lanes.ts):
 *       - `permissive` (default): always. This is exactly the routing that
 *         shipped before the switch existed — student_record and
 *         staff_entered prompts reach Gemini whenever `ai_provider` is
 *         cloud or unset. Production runs here today.
 *       - `lanes`: the `batch` and `emotional` lanes (document bytes, résumé
 *         extraction, endorsements) refuse; `coaching` may go cloud.
 *       - `local_only`: everything `lanes` refuses, plus every
 *         student_record / staff_entered prompt.
 *
 * A refusal writes a `blocked` AI audit event and throws
 * `AiCloudRefusedError`; there is no fallback. Callers must fail closed —
 * the chat route maps a resolver throw to a 503 with the 988 block, which
 * is the intended failure mode. Every allowed cloud call is recorded by its
 * caller's own audit event, so the data path stays auditable either way.
 *
 * `.claude/rules/sage-ai.md` states this same rule; keep the two in step.
 */
export async function resolveAiProvider(
  request: AIProviderRequest,
): Promise<AIProvider> {
  // The role decides WHICH local model serves the call; `ai_provider` and the
  // cloud policy decide WHETHER a local model serves it at all. Roles never
  // widen the routing rule, and the cloud provider ignores roles entirely
  // (Gemini is one model for every job).
  const role = request.role ?? roleForTask(request.task);

  const providerType = await getConfiguredProviderType();
  const cloudRequested =
    providerType === "cloud" ||
    (request.preferCloud === true && request.sensitivity === "public_program");

  if (!cloudRequested) {
    return getLocalProvider(role);
  }

  // Throws AiCloudRefusedError (after the blocked audit event) when the
  // policy refuses this task/sensitivity on a cloud model.
  await enforceCloudPolicy({
    studentId: request.studentId,
    task: request.task,
    sensitivity: request.sensitivity,
  });

  return getCloudProvider(request.studentId, request.sensitivity);
}

export function getPromptTier(provider: AIProvider): PromptTier {
  return provider.name === "ollama" ? "compact" : "full";
}
