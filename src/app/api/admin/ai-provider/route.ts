import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api-error";
import {
  deleteConfigValue,
  getPlainConfigValue,
  setPlainConfigValue,
  setConfigValue,
} from "@/lib/system-config";
import { logAuditEvent } from "@/lib/audit";
import { badRequest } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import {
  DEFAULT_LOCAL_AI_AUTH_MODE,
  readLocalAiProviderConfig,
  resolveLocalAiAuthMode,
  resolveLocalAiApiStyle,
} from "@/lib/ai";
// Imported from the leaf modules rather than the "@/lib/ai" barrel: the role
// constants are read at module-evaluation time to build the request schema,
// and suites that mock the barrel with a partial export set would leave them
// undefined. roles.ts is pure constants with no side effects.
import {
  AI_ROLES,
  AI_ROLE_MAX_OUTPUT_CONFIG_KEYS,
  AI_ROLE_MODEL_CONFIG_KEYS,
  AI_ROLE_PROFILES,
  type AiRole,
} from "@/lib/ai/roles";
import {
  readLocalAiRoleMaxOutputTokensRaw,
  readLocalAiRoleModels,
  readLocalAiRoleModelSources,
  resolveRoleModel,
} from "@/lib/ai/local-config";
import { isSafeAiProviderUrl } from "@/lib/validation";
import { z } from "zod";

const NUM_CTX_MIN = 1024;
const NUM_CTX_MAX = 131072;

// Mirrors the bounds provider.ts enforces when reading the cap back.
const MAX_OUTPUT_TOKENS_MIN = 128;
const MAX_OUTPUT_TOKENS_MAX = 32768;

// Accept either an integer in range or null (sent to clear the override).
const numCtxField = z
  .union([
    z.number().int().min(NUM_CTX_MIN).max(NUM_CTX_MAX),
    z.literal(null),
  ])
  .optional();

const providerSchema = z.object({
  provider: z.enum(["local", "cloud"]),
  url: z.string().url().optional(),
  model: z.string().min(1).max(100).optional(),
  embeddingModel: z.string().min(1).max(100).optional(),
  authMode: z.enum(["none", "bearer", "cloudflare_service_token"]).optional(),
  apiStyle: z.enum(["ollama", "openai"]).optional(),
  apiKey: z.string().max(500).optional(),
  cloudflareAccessClientId: z.string().max(500).optional(),
  cloudflareAccessClientSecret: z.string().max(500).optional(),
  numCtx: numCtxField,
  // Per-role model overrides. An empty string clears the override, putting
  // that role back on `model`. Absent leaves it untouched.
  roleModels: z
    .object(
      Object.fromEntries(
        AI_ROLES.map((role) => [role, z.string().max(100).optional()]),
      ) as Record<AiRole, z.ZodOptional<z.ZodString>>,
    )
    .partial()
    .optional(),
  // Per-role output caps. `null` clears; absent leaves untouched. Bounded here
  // with the same limits the provider enforces at read time, so an
  // out-of-range value is refused at the boundary instead of silently ignored
  // later — the operator would otherwise see a saved value that does nothing.
  roleMaxOutputTokens: z
    .object(
      Object.fromEntries(
        AI_ROLES.map((role) => [
          role,
          z
            .union([
              z.number().int().min(MAX_OUTPUT_TOKENS_MIN).max(MAX_OUTPUT_TOKENS_MAX),
              z.literal(null),
            ])
            .optional(),
        ]),
      ) as unknown as Record<AiRole, z.ZodOptional<z.ZodTypeAny>>,
    )
    .partial()
    .optional(),
});

export const GET = withAdminAuth(async () => {
  const [provider, localConfig, roleModels, roleModelSources, roleMaxOutputRaw] =
    await Promise.all([
      getPlainConfigValue("ai_provider"),
      readLocalAiProviderConfig(),
      readLocalAiRoleModels(),
      readLocalAiRoleModelSources(),
      Promise.all(
        AI_ROLES.map(async (role) => [role, await readLocalAiRoleMaxOutputTokensRaw(role)] as const),
      ),
    ]);

  // Echo back only values the provider will actually honor. A stored value
  // outside the bounds is ignored at read time, so rendering it in the box
  // would show the operator a setting that does nothing.
  const roleMaxOutputTokens = Object.fromEntries(
    roleMaxOutputRaw.map(([role, raw]) => {
      const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
      const valid =
        Number.isInteger(parsed) &&
        parsed >= MAX_OUTPUT_TOKENS_MIN &&
        parsed <= MAX_OUTPUT_TOKENS_MAX;
      return [role, valid ? parsed : null];
    }),
  ) as Record<AiRole, number | null>;

  const parsedNumCtx = localConfig.numCtxRaw
    ? Number.parseInt(localConfig.numCtxRaw, 10)
    : null;
  const validNumCtx =
    parsedNumCtx !== null &&
    Number.isFinite(parsedNumCtx) &&
    parsedNumCtx >= NUM_CTX_MIN &&
    parsedNumCtx <= NUM_CTX_MAX
      ? parsedNumCtx
      : null;

  return NextResponse.json({
    provider: provider || "cloud",
    url: localConfig.url || "",
    model: localConfig.model || "gemma4:26b",
    embeddingModel: localConfig.embeddingModel || "nomic-embed-text",
    authMode: localConfig.authMode,
    apiStyle: localConfig.apiStyle,
    numCtx: validNumCtx,
    numCtxBounds: { min: NUM_CTX_MIN, max: NUM_CTX_MAX, default: 8192 },
    roleModels,
    roleMaxOutputTokens,
    roleProfiles: AI_ROLES.map((role) => ({
      role,
      label: AI_ROLE_PROFILES[role].label,
      discriminator: AI_ROLE_PROFILES[role].discriminator,
      latency: AI_ROLE_PROFILES[role].latency,
      // What this role will ACTUALLY use once the fallback is applied, so the
      // operator never has to work it out from a blank field.
      effectiveModel: resolveRoleModel(role, roleModels, localConfig.model || "gemma4:26b"),
      // An env-pinned role cannot be cleared from this screen — deleting the
      // config row just hands control back to the env var.
      source: roleModelSources[role],
    })),
    hasApiKey: !!localConfig.apiKey,
    hasCloudflareAccessClientId: !!localConfig.cloudflareAccessClientId,
    hasCloudflareAccessClientSecret: !!localConfig.cloudflareAccessClientSecret,
  });
});

export const PUT = withAdminAuth(async (session, req: NextRequest) => {
  const body = await parseBody(req, providerSchema);
  const authMode = resolveLocalAiAuthMode(body.authMode);
  const apiStyle = resolveLocalAiApiStyle(body.apiStyle);
  const existingLocalConfig = await readLocalAiProviderConfig();

  if (body.url !== undefined && !isSafeAiProviderUrl(body.url)) {
    throw badRequest(
      "Invalid local AI server URL. Use localhost/127.0.0.1/::1 or a public http/https endpoint.",
    );
  }

  if (body.provider === "local") {
    const finalApiKey =
      body.apiKey !== undefined
        ? body.apiKey.trim() ||
          (existingLocalConfig.apiKeySource === "env"
            ? existingLocalConfig.apiKey
            : null)
        : existingLocalConfig.apiKey;
    const finalCloudflareAccessClientId =
      body.cloudflareAccessClientId !== undefined
        ? body.cloudflareAccessClientId.trim() ||
          (existingLocalConfig.cloudflareAccessClientIdSource === "env"
            ? existingLocalConfig.cloudflareAccessClientId
            : null)
        : existingLocalConfig.cloudflareAccessClientId;
    const finalCloudflareAccessClientSecret =
      body.cloudflareAccessClientSecret !== undefined
        ? body.cloudflareAccessClientSecret.trim() ||
          (existingLocalConfig.cloudflareAccessClientSecretSource === "env"
            ? existingLocalConfig.cloudflareAccessClientSecret
            : null)
        : existingLocalConfig.cloudflareAccessClientSecret;

    if (authMode === "bearer" && !finalApiKey) {
      throw badRequest(
        "Bearer token authentication is selected, but no bearer token is configured.",
      );
    }
    if (
      authMode === "cloudflare_service_token" &&
      (!finalCloudflareAccessClientId || !finalCloudflareAccessClientSecret)
    ) {
      throw badRequest(
        "Cloudflare service token authentication is selected, but both client ID and client secret are required.",
      );
    }
  }

  await setPlainConfigValue("ai_provider", body.provider, session.id);

  if (body.url !== undefined) {
    await setPlainConfigValue("ai_provider_url", body.url, session.id);
  }
  if (body.model !== undefined) {
    await setPlainConfigValue("ai_provider_model", body.model, session.id);
  }
  if (body.roleModels !== undefined) {
    for (const role of AI_ROLES) {
      const value = body.roleModels[role];
      if (value === undefined) continue;
      const trimmed = value.trim();
      if (trimmed) {
        await setPlainConfigValue(AI_ROLE_MODEL_CONFIG_KEYS[role], trimmed, session.id);
      } else {
        // Empty string clears the override; the role falls back to `model`.
        await deleteConfigValue(AI_ROLE_MODEL_CONFIG_KEYS[role]);
      }
    }
  }
  if (body.roleMaxOutputTokens !== undefined) {
    for (const role of AI_ROLES) {
      const value = body.roleMaxOutputTokens[role];
      if (value === undefined) continue;
      if (value === null) {
        await deleteConfigValue(AI_ROLE_MAX_OUTPUT_CONFIG_KEYS[role]);
      } else {
        await setPlainConfigValue(
          AI_ROLE_MAX_OUTPUT_CONFIG_KEYS[role],
          String(value),
          session.id,
        );
      }
    }
  }
  if (body.embeddingModel !== undefined) {
    await setPlainConfigValue(
      "ai_provider_embedding_model",
      body.embeddingModel,
      session.id,
    );
  }
  await setPlainConfigValue("ai_provider_auth_mode", authMode, session.id);
  await setPlainConfigValue("ai_provider_api_style", apiStyle, session.id);

  if (body.apiKey !== undefined) {
    if (body.apiKey === "") {
      await deleteConfigValue("ai_provider_api_key");
    } else {
      await setConfigValue("ai_provider_api_key", body.apiKey, session.id);
    }
  }
  if (body.cloudflareAccessClientId !== undefined) {
    if (body.cloudflareAccessClientId === "") {
      await deleteConfigValue("ai_provider_cloudflare_access_client_id");
    } else {
      await setConfigValue(
        "ai_provider_cloudflare_access_client_id",
        body.cloudflareAccessClientId,
        session.id,
      );
    }
  }
  if (body.cloudflareAccessClientSecret !== undefined) {
    if (body.cloudflareAccessClientSecret === "") {
      await deleteConfigValue("ai_provider_cloudflare_access_client_secret");
    } else {
      await setConfigValue(
        "ai_provider_cloudflare_access_client_secret",
        body.cloudflareAccessClientSecret,
        session.id,
      );
    }
  }

  if (body.numCtx !== undefined) {
    if (body.numCtx === null) {
      await deleteConfigValue("ai_provider_num_ctx");
    } else {
      await setPlainConfigValue(
        "ai_provider_num_ctx",
        String(body.numCtx),
        session.id,
      );
    }
  }

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.ai_provider.update",
    targetType: "system_config",
    targetId: "ai_provider",
    summary: `Admin set AI provider to "${body.provider}" with auth mode "${authMode || DEFAULT_LOCAL_AI_AUTH_MODE}".`,
  });

  return NextResponse.json({ success: true });
});
