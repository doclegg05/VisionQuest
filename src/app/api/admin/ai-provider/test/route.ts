import { NextResponse } from "next/server";
import { badRequest, withAdminAuth } from "@/lib/api-error";
import { getPlainConfigValue } from "@/lib/system-config";
import { checkOllamaHealth } from "@/lib/ai";
import { isSafeAiProviderUrl } from "@/lib/validation";

export const POST = withAdminAuth(async () => {
  const url = await getPlainConfigValue("ai_provider_url");
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

  const health = await checkOllamaHealth(url);

  if (!health.healthy) {
    return NextResponse.json(
      { error: `Could not reach the local AI server: ${health.error}` },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    models: health.models,
  });
});
