import { NextResponse } from "next/server";
import { badRequest, withAdminAuth } from "@/lib/api-error";
import {
  checkOllamaHealth,
  detectModelCapabilities,
  readLocalAiProviderConfig,
  toLocalAiAuthConfig,
} from "@/lib/ai";
import { isSafeAiProviderUrl } from "@/lib/validation";

export const POST = withAdminAuth(async () => {
  const config = await readLocalAiProviderConfig();
  if (!config.url) {
    return NextResponse.json(
      { error: "No local AI server URL configured." },
      { status: 400 },
    );
  }

  if (!isSafeAiProviderUrl(config.url)) {
    throw badRequest(
      "Invalid local AI server URL. Use localhost/127.0.0.1/::1 or a public http/https endpoint.",
    );
  }

  const authConfig = toLocalAiAuthConfig(config);

  const health = await checkOllamaHealth(config.url, {
    timeoutMs: 300_000,
    model: config.model,
    authConfig,
  });

  if (!health.healthy) {
    return NextResponse.json(
      { error: `Could not reach the local AI server: ${health.error}` },
      { status: 400 },
    );
  }

  const capabilities = await detectModelCapabilities({
    url: config.url,
    model: config.model,
    embeddingModel: config.embeddingModel,
    authConfig,
  });

  return NextResponse.json({
    success: true,
    models: health.models,
    apiMode: health.apiMode,
    chatValidated: health.chatValidated,
    modelUsed: health.modelUsed,
    capabilities,
  });
});
