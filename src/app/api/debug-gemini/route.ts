import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY || "";

  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent("Say hello in one sentence.");
    const text = result.response.text();
    return NextResponse.json({ status: "ok", response: text, keyPrefix: apiKey.slice(0, 10) + "..." });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : "Unknown";
    return NextResponse.json({ status: "error", name, message: msg }, { status: 500 });
  }
}
