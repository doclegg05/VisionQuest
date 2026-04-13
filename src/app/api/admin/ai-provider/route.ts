import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api-error";
import { getPlainConfigValue, setPlainConfigValue, setConfigValue, getConfigValue } from "@/lib/system-config";
import { logAuditEvent } from "@/lib/audit";
import { badRequest } from "@/lib/api-error";
import { parseBody } from "@/lib/schemas";
import { isSafeAiProviderUrl } from "@/lib/validation";
import { z } from "zod";

const providerSchema = z.object({
  provider: z.enum(["local", "cloud"]),
  url: z.string().url().optional(),
  model: z.string().min(1).max(100).optional(),
  apiKey: z.string().max(200).optional(),
});

export const GET = withAdminAuth(async () => {
  const [provider, url, model, apiKey] = await Promise.all([
    getPlainConfigValue("ai_provider"),
    getPlainConfigValue("ai_provider_url"),
    getPlainConfigValue("ai_provider_model"),
    getConfigValue("ai_provider_api_key"),
  ]);

  return NextResponse.json({
    provider: provider || "cloud",
    url: url || "",
    model: model || "gemma4:26b",
    hasApiKey: !!apiKey,
  });
});

export const PUT = withAdminAuth(async (session, req: NextRequest) => {
  const body = await parseBody(req, providerSchema);

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
  if (body.apiKey !== undefined) {
    if (body.apiKey === "") {
      await setPlainConfigValue("ai_provider_api_key", "", session.id);
    } else {
      await setConfigValue("ai_provider_api_key", body.apiKey, session.id);
    }
  }

  await logAuditEvent({
    actorId: session.id,
    actorRole: session.role,
    action: "admin.ai_provider.update",
    targetType: "system_config",
    targetId: "ai_provider",
    summary: `Admin set AI provider to "${body.provider}".`,
  });

  return NextResponse.json({ success: true });
});
