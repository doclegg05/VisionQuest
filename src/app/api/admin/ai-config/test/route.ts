import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api-error";
import { getConfigValue } from "@/lib/system-config";
import { GeminiProvider } from "@/lib/ai/gemini-provider";

export const POST = withAdminAuth(async () => {
  const apiKey = await getConfigValue("gemini_api_key");
  if (!apiKey) {
    return NextResponse.json(
      { error: "No platform API key configured. Save a key first." },
      { status: 400 },
    );
  }

  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const testAI = new GoogleGenerativeAI(apiKey);
    const model = testAI.getGenerativeModel({ model: GeminiProvider.modelName });
    await model.generateContent("Say hi in one word.");
  } catch {
    return NextResponse.json(
      { error: "The stored API key didn't work. It may be invalid or credits may be exhausted." },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true, model: GeminiProvider.modelName });
});
