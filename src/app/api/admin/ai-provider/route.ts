import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api-error";
import {
  deleteConfigValue,
  getPlainConfigValue,
  setPlainConfigValue,
  setConfigValue,
  getConfigValue,
} from "@/lib/system-config";
import { logAuditEvent } from "@/lib/audit";
import { badRequest } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { DEFAULT_LOCAL_AI_AUTH_MODE, resolveLocalAiAuthMode } from "@/lib/ai";
import { isSafeAiProviderUrl } from "@/lib/validation";
import { z } from "zod";

const providerSchema = z.object({
  provider: z.enum(["local", "cloud"]),
  url: z.string().url().optional(),
  model: z.string().min(1).max(100).optional(),
  authMode: z.enum(["none", "bearer", "cloudflare_service_token"]).optional(),
  apiKey: z.string().max(500).optional(),
  cloudflareAccessClientId: z.string().max(500).optional(),
  cloudflareAccessClientSecret: z.string().max(500).optional(),
});

export const GET = withAdminAuth(async () => {
  const [
    provider,
    url,
    model,
    authMode,
    apiKey,
    cloudflareAccessClientId,
    cloudflareAccessClientSecret,
  ] = await Promise.all([
    getPlainConfigValue("ai_provider"),
    getPlainConfigValue("ai_provider_url"),
    getPlainConfigValue("ai_provider_model"),
    getPlainConfigValue("ai_provider_auth_mode"),
    getConfigValue("ai_provider_api_key"),
    getConfigValue("ai_provider_cloudflare_access_client_id"),
    getConfigValue("ai_provider_cloudflare_access_client_secret"),
  ]);

  return NextResponse.json({
    provider: provider || "cloud",
    url: url || "",
    model: model || "gemma4:26b",
    authMode: resolveLocalAiAuthMode(authMode),
    hasApiKey: !!apiKey,
    hasCloudflareAccessClientId: !!cloudflareAccessClientId,
    hasCloudflareAccessClientSecret: !!cloudflareAccessClientSecret,
  });
});

export const PUT = withAdminAuth(async (session, req: NextRequest) => {
  const body = await parseBody(req, providerSchema);
  const authMode = resolveLocalAiAuthMode(body.authMode);

  if (body.url !== undefined && !isSafeAiProviderUrl(body.url)) {
    throw badRequest(
      "Invalid local AI server URL. Use localhost/127.0.0.1/::1 or a public http/https endpoint.",
    );
  }

  await setPlainConfigValue("ai_provider", body.provider, session.id);

  if (body.url !== undefined) {
    await setPlainConfigValue("ai_provider_url", body.url, session.id);
  }
  if (body.model !== undefined) {
    await setPlainConfigValue("ai_provider_model", body.model, session.id);
  }
  await setPlainConfigValue("ai_provider_auth_mode", authMode, session.id);

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
