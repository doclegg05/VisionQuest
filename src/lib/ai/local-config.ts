import { getConfigValue, getPlainConfigValue } from "@/lib/system-config";
import { resolveLocalAiAuthMode } from "./local-auth";
import type { LocalAIAuthConfig, LocalAIAuthMode } from "./types";

export const DEFAULT_OLLAMA_MODEL = "gemma4:26b";
/** Native 768-dim local embedding model; matches EMBEDDING_DIMENSIONS. */
export const DEFAULT_LOCAL_EMBEDDING_MODEL = "nomic-embed-text";

const API_KEY_ENV_VARS = [
  "AI_PROVIDER_API_KEY",
  "OLLAMA_API_KEY",
] as const;

const EMBEDDING_MODEL_ENV_VARS = ["AI_PROVIDER_EMBEDDING_MODEL"] as const;

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
  numCtxRaw: string | null;
  apiKey: string | null;
  apiKeySource: "config" | "env" | null;
  cloudflareAccessClientId: string | null;
  cloudflareAccessClientIdSource: "config" | "env" | null;
  cloudflareAccessClientSecret: string | null;
  cloudflareAccessClientSecretSource: "config" | "env" | null;
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
    numCtxRaw,
    apiKeyResult,
    cloudflareAccessClientIdResult,
    cloudflareAccessClientSecretResult,
  ] = await Promise.all([
    getPlainConfigValue("ai_provider_url"),
    getPlainConfigValue("ai_provider_model"),
    getPlainConfigValue("ai_provider_embedding_model"),
    getPlainConfigValue("ai_provider_auth_mode"),
    getPlainConfigValue("ai_provider_num_ctx"),
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
    numCtxRaw,
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
  >,
  options: { numCtx?: number } = {},
): LocalAIAuthConfig {
  return {
    authMode: config.authMode,
    apiKey: config.apiKey,
    cloudflareAccessClientId: config.cloudflareAccessClientId,
    cloudflareAccessClientSecret: config.cloudflareAccessClientSecret,
    numCtx: options.numCtx,
  };
}
