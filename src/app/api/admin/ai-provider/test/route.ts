import { NextResponse } from "next/server";
import { badRequest, withAdminAuth } from "@/lib/api-error";
import { getPlainConfigValue, getConfigValue } from "@/lib/system-config";
import { checkOllamaHealth, resolveLocalAiAuthMode } from "@/lib/ai";
import { isSafeAiProviderUrl } from "@/lib/validation";

export const POST = withAdminAuth(async () => {
  const [
    url,
    model,
    authModeRaw,
    apiKey,
    cloudflareAccessClientId,
    cloudflareAccessClientSecret,
  ] = await Promise.all([
    getPlainConfigValue("ai_provider_url"),
    getPlainConfigValue("ai_provider_model"),
    getPlainConfigValue("ai_provider_auth_mode"),
    getConfigValue("ai_provider_api_key"),
    getConfigValue("ai_provider_cloudflare_access_client_id"),
    getConfigValue("ai_provider_cloudflare_access_client_secret"),
  ]);
  if (!url) {
    return NextResponse.json(
      { error: "No local AI server URL configured." },
      { status: 400 },
    );
  }

  if (!isSafeAiProviderUrl(url)) {
    throw badRequest(
      "Invalid local AI server URL. Use localhost/127.0.0.1/::1 or a public http/https endpoint.",
    );
  }

  const health = await checkOllamaHealth(url, {
    timeoutMs: 300_000,
    model,
    authConfig: {
      authMode: resolveLocalAiAuthMode(authModeRaw),
      apiKey,
      cloudflareAccessClientId,
      cloudflareAccessClientSecret,
    },
  });

  if (!health.healthy) {
    return NextResponse.json(
      { error: `Could not reach the local AI server: ${health.error}` },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    models: health.models,
    apiMode: health.apiMode,
    chatValidated: health.chatValidated,
    modelUsed: health.modelUsed,
  });
});
