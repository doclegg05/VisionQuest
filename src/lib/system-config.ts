import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { cached, invalidatePrefix } from "@/lib/cache";

export const SYSTEM_CONFIG_KEYS = [
  "gemini_api_key",
  "ai_provider",
  "ai_provider_url",
  "ai_provider_model",
  "ai_provider_auth_mode",
  "ai_provider_api_key",
  "ai_provider_cloudflare_access_client_id",
  "ai_provider_cloudflare_access_client_secret",
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
    prisma.systemConfig.findUnique({
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

  await prisma.systemConfig.upsert({
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
  await prisma.systemConfig.deleteMany({ where: { key } });
  invalidatePrefix(`sysconfig:${key}`);
}

/**
 * Get a config value WITHOUT decryption (for non-secret values like ai_provider).
 * Returns null if not set.
 */
export async function getPlainConfigValue(key: SystemConfigKey): Promise<string | null> {
  const row = await cached(`sysconfig:${key}`, CACHE_TTL, () =>
    prisma.systemConfig.findUnique({
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
  await prisma.systemConfig.upsert({
    where: { key },
    update: { value, updatedBy },
    create: { key, value, updatedBy },
  });

  invalidatePrefix(`sysconfig:${key}`);
}
