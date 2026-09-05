import { prismaAdmin } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { cached, invalidatePrefix } from "@/lib/cache";

export const SYSTEM_CONFIG_KEYS = [
  "gemini_api_key",
  "ai_provider",
  "ai_provider_url",
  "ai_provider_model",
  // Per-role local model overrides. Unset → the role uses
  // `ai_provider_model`, i.e. the single-model behavior that predates roles.
  // A role is a capability profile, not a call site — see src/lib/ai/roles.ts
  // for what each one has to be good at and which AiTasks map to it.
  "ai_provider_model_chat",
  "ai_provider_model_extract",
  "ai_provider_model_document",
  "ai_provider_model_draft",
  // Per-role output-token caps. Unset → the provider's global default
  // (768 free-text / 512 structured), i.e. unchanged. Raise the roles whose
  // output does not fit — see src/lib/ai/roles.ts.
  "ai_provider_max_output_tokens_chat",
  "ai_provider_max_output_tokens_extract",
  "ai_provider_max_output_tokens_document",
  "ai_provider_max_output_tokens_draft",
  "ai_provider_embedding_model",
  "ai_provider_auth_mode",
  // "ollama" (default) | "openai" — generic OpenAI-compatible endpoint mode.
  // See src/lib/ai/types.ts LocalAiApiStyle.
  "ai_provider_api_style",
  "ai_provider_api_key",
  "ai_provider_cloudflare_access_client_id",
  "ai_provider_cloudflare_access_client_secret",
  // Optional integer override for Ollama's num_ctx (KV-cache window size).
  // Unset → provider default (8192). Bounds enforced at read time.
  "ai_provider_num_ctx",
  // "on"/"true"/"1" lets a thinking model emit its reasoning channel.
  // Unset → OFF, because reasoning tokens share the output budget with the
  // visible reply and can consume all of it. See LocalAIAuthConfig.reasoning.
  "ai_provider_reasoning",
  // Optional integer override for the per-request output cap
  // (num_predict / max_tokens). Unset → provider default (768).
  // Raise this when enabling reasoning. Bounds enforced at read time.
  "ai_provider_max_output_tokens",
  // Phase 0A placement bridge pilot flag (plain value, not encrypted).
  // Unset/empty → bridge OFF. "all" → every class. Otherwise a
  // comma-separated list of SpokesClass IDs whose actively enrolled
  // students get the "Record employment outcome" queue item.
  "placement_bridge_classes",
  // Match & Connect Phase 4 pilot flag (plain value). Unset/empty → Connect
  // OFF. "all" → every class. Otherwise a comma-separated list of SpokesClass
  // IDs. Gates the Sage tool, the student pending endpoint, the console's
  // connection actions and the employer response page.
  //
  // IT ALSO TURNS ON `placement_bridge_classes` for the same classes
  // (mergePlacementBridgeScopes in src/lib/placement-bridge.ts), because a
  // hire recorded through a Connection otherwise creates a verified
  // Application and then nothing happens — no staff queue item, no SPOKES
  // prefill. Setting this key therefore starts raising placement queue items
  // in those classes even if the bridge key is still unset. The widening is
  // logged once per process so it is visible in the logs and not only here.
  "connect_enabled_classes",
  // "true"/"on"/"1" lets a VERIFIED subsidy rule render on an employer page.
  // Unset → OFF, and every figure in src/lib/connect/subsidies-shared.ts also
  // ships unverified, so both gates have to be opened deliberately.
  "connect_subsidy_lines_enabled",
  // Match & Connect Phase 5 pilot flag, same shape as connect_enabled_classes.
  // Unset/empty → no student is ever texted by the nudge runner. Both this and
  // connect_enabled_classes must admit a class before its students get SMS.
  "sms_nudges_enabled_classes",
] as const;
export type SystemConfigKey = (typeof SYSTEM_CONFIG_KEYS)[number];

export function isValidConfigKey(key: string): key is SystemConfigKey {
  return SYSTEM_CONFIG_KEYS.includes(key as SystemConfigKey);
}

const CACHE_TTL = 60; // seconds

/**
 * Get a config value (decrypted). Returns null if not set.
 * Cached for 60 seconds to avoid per-request DB hits.
 */
export async function getConfigValue(key: SystemConfigKey): Promise<string | null> {
  const row = await cached(`sysconfig:${key}`, CACHE_TTL, () =>
    prismaAdmin.systemConfig.findUnique({
      where: { key },
      select: { value: true },
    }),
  );

  if (!row?.value) return null;

  try {
    return decrypt(row.value);
  } catch {
    return null;
  }
}

/**
 * Set a config value (encrypted). Creates or updates.
 */
export async function setConfigValue(
  key: SystemConfigKey,
  plaintext: string,
  updatedBy: string,
): Promise<void> {
  const encrypted = encrypt(plaintext);

  await prismaAdmin.systemConfig.upsert({
    where: { key },
    update: { value: encrypted, updatedBy },
    create: { key, value: encrypted, updatedBy },
  });

  invalidatePrefix(`sysconfig:${key}`);
}

/**
 * Remove a config value.
 */
export async function deleteConfigValue(key: SystemConfigKey): Promise<void> {
  await prismaAdmin.systemConfig.deleteMany({ where: { key } });
  invalidatePrefix(`sysconfig:${key}`);
}

/**
 * Get a config value WITHOUT decryption (for non-secret values like ai_provider).
 * Returns null if not set.
 */
export async function getPlainConfigValue(key: SystemConfigKey): Promise<string | null> {
  const row = await cached(`sysconfig:${key}`, CACHE_TTL, () =>
    prismaAdmin.systemConfig.findUnique({
      where: { key },
      select: { value: true },
    }),
  );

  return row?.value ?? null;
}

/**
 * Set a config value WITHOUT encryption (for non-secret values).
 */
export async function setPlainConfigValue(
  key: SystemConfigKey,
  value: string,
  updatedBy: string,
): Promise<void> {
  await prismaAdmin.systemConfig.upsert({
    where: { key },
    update: { value, updatedBy },
    create: { key, value, updatedBy },
  });

  invalidatePrefix(`sysconfig:${key}`);
}
