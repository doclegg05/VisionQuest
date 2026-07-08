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
import { isSafeAiProviderUrl } from "@/lib/validation";
import { z } from "zod";

const NUM_CTX_MIN = 1024;
const NUM_CTX_MAX = 131072;

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
});

export const GET = withAdminAuth(async () => {
  const [provider, localConfig] = await Promise.all([
    getPlainConfigValue("ai_provider"),
    readLocalAiProviderConfig(),
  ]);

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
