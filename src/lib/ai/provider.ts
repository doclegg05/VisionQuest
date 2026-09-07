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
import { getProviderClass, logAiAuditEvent } from "./audit";
import { TokenVault, neutralizeTokenShapes, type IdentityInput } from "./deidentify";
import { DEIDENTIFY_ALLOWLIST } from "./deidentify-allowlist";
import { withDeidentification } from "./with-deidentification";
import { loadIdentityInput } from "./identity";
import { OllamaProvider } from "./ollama-provider";
import { GeminiProvider } from "./gemini-provider";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderType,
  DataSensitivity,
  DescribeDocumentOptions,
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
 *
 * The predicate is an ALLOWLIST (`=== "public_program"`), not the negation of
 * `isLocalOnlySensitivity`. The negation admitted `configured` and `system`
 * too — sensitivities no production call site declares, so the hole was
 * latent, but the next caller to declare one would have got a personal key on
 * student content with nothing failing (2026-09-07 security audit, W3). An
 * allowlist means a sensitivity added later is refused by default.
 */
async function getCloudProvider(
  studentId: string,
  sensitivity: DataSensitivity,
): Promise<AIProvider> {
  const apiKey = await resolveApiKey(studentId, {
    allowPersonalKey: sensitivity === "public_program",
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

// `getProvider(studentId, role)` was removed on 2026-09-07. It resolved a
// provider with sensitivity "configured" and consulted NEITHER the cloud
// policy nor the de-identification layer, so on a `local_only` deployment it
// returned Gemini with no audit event and a personal key permitted — a
// complete bypass of both controls, exported from the barrel for anyone to
// reach (security audit W3). It had no production caller; its coverage of the
// local-provider config path moved to `resolveAiProvider` in
// `__tests__/provider.test.ts`. Do not reintroduce a resolver that takes no
// sensitivity: the sensitivity is what both controls key off.

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

  const provider = await getCloudProvider(request.studentId, request.sensitivity);

  // AFTER the refusal, never before: a refused call must not be
  // de-identified and sent anyway.
  return maybeDeidentify(provider, request);
}

// ---------------------------------------------------------------------------
// De-identification (FERPA review Sprint 3, memo B §2.0)
// ---------------------------------------------------------------------------

/**
 * Kill switch for the de-identification decorator. `"off"` disables it;
 * anything else, INCLUDING unset, leaves it on.
 *
 * The default is deliberately the opposite of `ai_cloud_policy`'s: that
 * switch defaults to today's behaviour because turning it on can refuse a
 * student's chat turn, while this one only changes what leaves the process
 * and never refuses anything. An operator who needs the raw prompt back (a
 * model behaving oddly with placeholders, say) sets it to `"off"`, and the
 * `routed` audit events stop appearing, which is how the change is visible.
 */
export const AI_DEIDENTIFY_CONFIG_KEY = "ai_deidentify_cloud";
export const AI_DEIDENTIFY_ENV = "AI_DEIDENTIFY_CLOUD";

async function isDeidentifyEnabled(): Promise<boolean> {
  const configured = await getPlainConfigValue(AI_DEIDENTIFY_CONFIG_KEY);
  const raw = configured?.trim() ? configured : process.env[AI_DEIDENTIFY_ENV] ?? "";
  return raw.trim().toLowerCase() !== "off";
}

/** Later fields win only when they carry something; arrays concatenate. */
function mergeIdentity(base: IdentityInput, extra?: IdentityInput): IdentityInput {
  if (!extra) return base;
  const names = (a?: readonly string[], b?: readonly string[]): string[] | undefined => {
    const merged = [...new Set([...(a ?? []), ...(b ?? [])].filter((name) => name?.trim()))];
    return merged.length > 0 ? merged : undefined;
  };
  return {
    studentName: extra.studentName?.trim() || base.studentName,
    studentEmail: extra.studentEmail?.trim() || base.studentEmail,
    studentLoginId: extra.studentLoginId?.trim() || base.studentLoginId,
    studentPhone: extra.studentPhone?.trim() || base.studentPhone,
    staffNames: names(base.staffNames, extra.staffNames),
    rosterNames: names(base.rosterNames, extra.rosterNames),
  };
}

/**
 * Carry across the two things `withDeidentification` cannot know about,
 * because they are not part of the `AIProvider` contract it copies:
 *
 *  - `model`: `withUsageLogging` reads `provider.model` to stamp the real
 *    model tag on every `LlmCallLog` row. A wrapper without it would record
 *    the class name and make a per-role model split unmeasurable — the exact
 *    regression the 2026-08-21 decision log warns about.
 *  - `describeDocument`: the cloud-only multimodal method Wave 1 routes
 *    uploaded document bytes through. A wrapper that dropped it would make
 *    `file-gist` silently fall back to deterministic extraction the day this
 *    shipped. The BYTES are not de-identified (nothing here can read a PDF),
 *    which is a documented limit; the prompt and the reply are.
 *
 * Both belong in `with-deidentification.ts` eventually — they are properties
 * of the decorator, not of the resolver. They live here because that file is
 * outside this change's fence.
 */
function preserveProviderExtras(raw: AIProvider, wrapped: AIProvider, vault: TokenVault): AIProvider {
  const model = (raw as { model?: string }).model;
  if (typeof model === "string") {
    Object.defineProperty(wrapped, "model", { value: model, enumerable: true });
  }
  if (raw.describeDocument) {
    const describe = raw.describeDocument.bind(raw);
    wrapped.describeDocument = async (
      buffer: Buffer,
      mimeType: string,
      prompt: string,
      options?: DescribeDocumentOptions,
    ): Promise<string> =>
      // Same outbound transform as the decorator's four methods: the prompt
      // interpolates the uploaded filename, so a file named "[PERSON_3].pdf"
      // must not reach the model as a live token shape.
      vault.rehydrate(
        await describe(buffer, mimeType, vault.pseudonymize(neutralizeTokenShapes(prompt)), options),
      );
  }
  return wrapped;
}

/**
 * Wrap a resolved CLOUD provider so identifiers are substituted on the way
 * out and restored on the way back in. Applied here rather than at the call
 * sites so a call site that forgets cannot exist (memo B §2.0).
 *
 * Fail-OPEN by design: an identity that cannot be loaded yields an empty
 * vault and the raw provider, which is exactly today's behaviour for that
 * call. The fail-CLOSED contract belongs to the policy refusal, which has
 * already run by the time we get here.
 */
async function maybeDeidentify(
  provider: AIProvider,
  request: AIProviderRequest,
): Promise<AIProvider> {
  if (getProviderClass(provider.name) !== "cloud") return provider;
  if (!isLocalOnlySensitivity(request.sensitivity)) return provider;
  if (!(await isDeidentifyEnabled())) return provider;

  const loaded = await (async () => {
    try {
      return await loadIdentityInput({
        studentId: request.studentId,
        sessionRole: request.sessionRole,
        sessionDisplayName: request.sessionDisplayName,
      });
    } catch {
      return {} as IdentityInput;
    }
  })();
  const vault = TokenVault.fromIdentity(mergeIdentity(loaded, request.identity), {
    allowlist: DEIDENTIFY_ALLOWLIST,
  });
  if (vault.isEmpty) return provider;

  const wrapped = preserveProviderExtras(provider, withDeidentification(provider, vault), vault);
  await logAiAuditEvent({
    actorId: request.studentId,
    actorRole: null,
    route: "ai.resolve",
    task: request.task,
    sensitivity: request.sensitivity,
    policyDecision: "configured_provider",
    status: "routed",
    targetId: request.studentId,
    providerName: provider.name,
    providerClass: "cloud",
    allowCloud: true,
    // Token NAMES only. A vault VALUE in the audit log would put the very
    // identifiers this layer removes into a table staff can read.
    metadata: { deidentified: true, tokens: vault.tokenNames() },
  });
  return wrapped;
}

export function getPromptTier(provider: AIProvider): PromptTier {
  return provider.name === "ollama" ? "compact" : "full";
}
