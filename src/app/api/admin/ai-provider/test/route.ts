import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api-error";
import { getPlainConfigValue } from "@/lib/system-config";
import { checkOllamaHealth } from "@/lib/ai";

export const POST = withAdminAuth(async () => {
  const url = await getPlainConfigValue("ai_provider_url");
  if (!url) {
    return NextResponse.json(
      { error: "No local AI server URL configured." },
      { status: 400 },
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
