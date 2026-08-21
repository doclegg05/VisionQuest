import { getConfigValue, getPlainConfigValue } from "@/lib/system-config";
import { resolveLocalAiAuthMode } from "./local-auth";
import {
  AI_ROLES,
  AI_ROLE_MAX_OUTPUT_CONFIG_KEYS,
  AI_ROLE_MODEL_CONFIG_KEYS,
  type AiRole,
} from "./roles";
import type { LocalAIAuthConfig, LocalAIAuthMode, LocalAiApiStyle } from "./types";

export const DEFAULT_OLLAMA_MODEL = "gemma4:26b";
/** Native 768-dim local embedding model; matches EMBEDDING_DIMENSIONS. */
export const DEFAULT_LOCAL_EMBEDDING_MODEL = "nomic-embed-text";

const API_KEY_ENV_VARS = [
  "AI_PROVIDER_API_KEY",
  "OLLAMA_API_KEY",
] as const;

const EMBEDDING_MODEL_ENV_VARS = ["AI_PROVIDER_EMBEDDING_MODEL"] as const;

const API_STYLE_ENV_VARS = ["AI_PROVIDER_API_STYLE"] as const;

const REASONING_ENV_VARS = ["AI_PROVIDER_REASONING"] as const;

const MAX_OUTPUT_TOKENS_ENV_VARS = ["AI_PROVIDER_MAX_OUTPUT_TOKENS"] as const;

const CLOUDFLARE_CLIENT_ID_ENV_VARS = [
  "AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_ID",
  "CF_ACCESS_CLIENT_ID",
  "CLOUDFLARE_ACCESS_CLIENT_ID",
] as const;

const CLOUDFLARE_CLIENT_SECRET_ENV_VARS = [
  "AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_SECRET",
  "CF_ACCESS_CLIENT_SECRET",
  "CLOUDFLARE_ACCESS_CLIENT_SECRET",
] as const;

export interface LocalAiProviderConfig {
  url: string | null;
  model: string | null;
  /** SystemConfig "ai_provider_embedding_model" (+ env fallback AI_PROVIDER_EMBEDDING_MODEL). */
  embeddingModel: string | null;
  authMode: LocalAIAuthMode;
  /** SystemConfig "ai_provider_api_style" (+ env fallback AI_PROVIDER_API_STYLE). Defaults to "ollama". */
  apiStyle: LocalAiApiStyle;
  numCtxRaw: string | null;
  /** SystemConfig "ai_provider_reasoning" (+ env fallback AI_PROVIDER_REASONING). */
  reasoningRaw: string | null;
  /** SystemConfig "ai_provider_max_output_tokens" (+ env AI_PROVIDER_MAX_OUTPUT_TOKENS). */
  maxOutputTokensRaw: string | null;
  apiKey: string | null;
  apiKeySource: "config" | "env" | null;
  cloudflareAccessClientId: string | null;
  cloudflareAccessClientIdSource: "config" | "env" | null;
  cloudflareAccessClientSecret: string | null;
  cloudflareAccessClientSecretSource: "config" | "env" | null;
}

export function resolveLocalAiApiStyle(
  apiStyle: string | null | undefined,
): LocalAiApiStyle {
  return apiStyle === "openai" ? "openai" : "ollama";
}

function firstEnvValue(names: readonly string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

async function getSecretConfigOrEnv(
  key:
    | "ai_provider_api_key"
    | "ai_provider_cloudflare_access_client_id"
    | "ai_provider_cloudflare_access_client_secret",
  envNames: readonly string[],
): Promise<{ value: string | null; source: "config" | "env" | null }> {
  const configValue = await getConfigValue(key);
  if (configValue) return { value: configValue, source: "config" };

  const envValue = firstEnvValue(envNames);
  if (envValue) return { value: envValue, source: "env" };

  return { value: null, source: null };
}

export async function readLocalAiProviderConfig(): Promise<LocalAiProviderConfig> {
  const [
    url,
    model,
    embeddingModelConfig,
    authModeRaw,
    apiStyleConfig,
    numCtxRaw,
    reasoningConfig,
    maxOutputTokensConfig,
    apiKeyResult,
    cloudflareAccessClientIdResult,
    cloudflareAccessClientSecretResult,
  ] = await Promise.all([
    getPlainConfigValue("ai_provider_url"),
    getPlainConfigValue("ai_provider_model"),
    getPlainConfigValue("ai_provider_embedding_model"),
    getPlainConfigValue("ai_provider_auth_mode"),
    getPlainConfigValue("ai_provider_api_style"),
    getPlainConfigValue("ai_provider_num_ctx"),
    getPlainConfigValue("ai_provider_reasoning"),
    getPlainConfigValue("ai_provider_max_output_tokens"),
    getSecretConfigOrEnv("ai_provider_api_key", API_KEY_ENV_VARS),
    getSecretConfigOrEnv(
      "ai_provider_cloudflare_access_client_id",
      CLOUDFLARE_CLIENT_ID_ENV_VARS,
    ),
    getSecretConfigOrEnv(
      "ai_provider_cloudflare_access_client_secret",
      CLOUDFLARE_CLIENT_SECRET_ENV_VARS,
    ),
  ]);

  return {
    url,
    model,
    embeddingModel: embeddingModelConfig || firstEnvValue(EMBEDDING_MODEL_ENV_VARS),
    authMode: resolveLocalAiAuthMode(authModeRaw),
    apiStyle: resolveLocalAiApiStyle(apiStyleConfig || firstEnvValue(API_STYLE_ENV_VARS)),
    numCtxRaw,
    reasoningRaw: reasoningConfig || firstEnvValue(REASONING_ENV_VARS),
    maxOutputTokensRaw:
      maxOutputTokensConfig || firstEnvValue(MAX_OUTPUT_TOKENS_ENV_VARS),
    apiKey: apiKeyResult.value,
    apiKeySource: apiKeyResult.source,
    cloudflareAccessClientId: cloudflareAccessClientIdResult.value,
    cloudflareAccessClientIdSource: cloudflareAccessClientIdResult.source,
    cloudflareAccessClientSecret: cloudflareAccessClientSecretResult.value,
    cloudflareAccessClientSecretSource: cloudflareAccessClientSecretResult.source,
  };
}

export function toLocalAiAuthConfig(
  config: Pick<
    LocalAiProviderConfig,
    | "authMode"
    | "apiKey"
    | "cloudflareAccessClientId"
    | "cloudflareAccessClientSecret"
    | "apiStyle"
  >,
  options: {
    numCtx?: number;
    reasoning?: boolean;
    maxOutputTokens?: number;
    keepAlive?: string;
    structuredMaxOutputTokens?: number;
  } = {},
): LocalAIAuthConfig {
  return {
    authMode: config.authMode,
    apiKey: config.apiKey,
    cloudflareAccessClientId: config.cloudflareAccessClientId,
    cloudflareAccessClientSecret: config.cloudflareAccessClientSecret,
    numCtx: options.numCtx,
    apiStyle: config.apiStyle,
    reasoning: options.reasoning,
    maxOutputTokens: options.maxOutputTokens,
    keepAlive: options.keepAlive,
    structuredMaxOutputTokens: options.structuredMaxOutputTokens,
  };
}

/**
 * Read the model override for one role, with an env fallback so an operator
 * can pin a role without a database write (`AI_PROVIDER_MODEL_CHAT`, …).
 *
 * Returns null when the role has no override — the caller must then fall back
 * to `ai_provider_model`. Null is the safe answer: an unconfigured role
 * behaves exactly as it did before roles existed.
 */
export async function readLocalAiRoleModel(role: AiRole): Promise<string | null> {
  return (await readLocalAiRoleModelWithSource(role)).value;
}

/**
 * The role's model plus WHERE it came from.
 *
 * The source matters to the admin surface: clearing a role's field deletes its
 * SystemConfig row, but an `AI_PROVIDER_MODEL_<ROLE>` env var then takes over
 * rather than the main model. Without the source, the panel would show a
 * cleared-then-repopulated field in an editable box and the operator would
 * believe they had unset something they had not.
 */
export async function readLocalAiRoleModelWithSource(
  role: AiRole,
): Promise<{ value: string | null; source: "config" | "env" | null }> {
  const configured = await getPlainConfigValue(AI_ROLE_MODEL_CONFIG_KEYS[role]);
  if (configured?.trim()) return { value: configured.trim(), source: "config" };
  const fromEnv = firstEnvValue([`AI_PROVIDER_MODEL_${role.toUpperCase()}`]);
  return fromEnv ? { value: fromEnv, source: "env" } : { value: null, source: null };
}

/** Which roles are pinned by an environment variable the admin UI cannot clear. */
export async function readLocalAiRoleModelSources(): Promise<
  Record<AiRole, "config" | "env" | null>
> {
  const entries = await Promise.all(
    AI_ROLES.map(async (role) => [role, (await readLocalAiRoleModelWithSource(role)).source] as const),
  );
  return Object.fromEntries(entries) as Record<AiRole, "config" | "env" | null>;
}

/**
 * Read every role's model override at once. Used by the admin surface, the
 * AI-provider capability probe, and `sage:model:bakeoff` — anything that has
 * to show or verify the whole mapping rather than serve one call.
 */
export async function readLocalAiRoleModels(): Promise<Record<AiRole, string | null>> {
  const entries = await Promise.all(
    AI_ROLES.map(async (role) => [role, await readLocalAiRoleModel(role)] as const),
  );
  return Object.fromEntries(entries) as Record<AiRole, string | null>;
}

/**
 * Read the raw output-token cap override for one role, with an env fallback
 * (`AI_PROVIDER_MAX_OUTPUT_TOKENS_CHAT`, …). Returned unparsed — the caller
 * bounds it, the same way the global cap is bounded in provider.ts.
 */
export async function readLocalAiRoleMaxOutputTokensRaw(
  role: AiRole,
): Promise<string | null> {
  const configured = await getPlainConfigValue(AI_ROLE_MAX_OUTPUT_CONFIG_KEYS[role]);
  if (configured?.trim()) return configured.trim();
  return firstEnvValue([`AI_PROVIDER_MAX_OUTPUT_TOKENS_${role.toUpperCase()}`]);
}

/**
 * The model that will actually serve `role`, given the global default.
 * Centralized so the admin surface, the bake-off, and the provider factory
 * can never disagree about which model a role resolves to.
 */
export function resolveRoleModel(
  role: AiRole | null,
  roleModels: Partial<Record<AiRole, string | null>>,
  globalModel: string,
): string {
  if (!role) return globalModel;
  return roleModels[role]?.trim() || globalModel;
}
