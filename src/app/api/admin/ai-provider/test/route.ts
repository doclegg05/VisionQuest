import { NextResponse } from "next/server";
import { badRequest, withAdminAuth } from "@/lib/api-error";
import {
  checkOllamaHealth,
  detectModelCapabilities,
  readLocalAiProviderConfig,
  toLocalAiAuthConfig,
} from "@/lib/ai";
// From the leaf modules, not the "@/lib/ai" barrel: suites that mock the
// barrel with a partial export set would otherwise leave these undefined.
// `findMissingRoleModels` is a pure function and wants the real impl anyway.
import { findMissingRoleModels } from "@/lib/ai/capabilities";
import { readLocalAiRoleModels } from "@/lib/ai/local-config";
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

  // A per-role model is only exercised by the job that uses it, so a typo in
  // the `extract` model would otherwise surface hours later as extractions
  // silently storing nothing. Check it while the operator is still looking.
  const roleModels = await readLocalAiRoleModels();
  const missingRoleModels = findMissingRoleModels(roleModels, health.models ?? []);

  return NextResponse.json({
    success: true,
    models: health.models,
    missingRoleModels,
    apiMode: health.apiMode,
    chatValidated: health.chatValidated,
    modelUsed: health.modelUsed,
    capabilities,
  });
});
