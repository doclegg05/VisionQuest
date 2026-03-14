import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function GET(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY || "";
  const url = new URL(req.url);
  const testStream = url.searchParams.get("stream") === "1";

  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    if (testStream) {
      // Test SSE streaming — same pattern as Sage chat
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            const chat = model.startChat({
              systemInstruction: { role: "user", parts: [{ text: "You are a helpful assistant. Reply briefly." }] },
              history: [],
            });
            const result = await chat.sendMessageStream("Say hello in one sentence.");
            let full = "";
            for await (const chunk of result.stream) {
              const text = chunk.text();
              if (text) {
                full += text;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
              }
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, fullResponse: full })}\n\n`));
            controller.close();
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Non-streaming test
    const result = await model.generateContent("Say hello in one sentence.");
    const text = result.response.text();
    return NextResponse.json({ status: "ok", response: text, keyPrefix: apiKey.slice(0, 10) + "..." });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : "Unknown";
    return NextResponse.json({ status: "error", name, message: msg }, { status: 500 });
  }
}
