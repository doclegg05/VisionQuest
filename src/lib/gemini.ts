import { GoogleGenerativeAI } from "@google/generative-ai";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

export function getModel(apiKey: string, systemInstruction?: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    ...(systemInstruction ? { systemInstruction } : {}),
  });
}

export async function generateResponse(
  apiKey: string,
  systemPrompt: string,
  messages: { role: "user" | "model"; content: string }[]
) {
  const model = getModel(apiKey, systemPrompt);

  const chat = model.startChat({
    history: messages.slice(0, -1).map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
  });

  const lastMessage = messages[messages.length - 1];
  const result = await chat.sendMessage(lastMessage.content);
  return result.response.text();
}

export async function* streamResponse(
  apiKey: string,
  systemPrompt: string,
  messages: { role: "user" | "model"; content: string }[]
) {
  const model = getModel(apiKey, systemPrompt);

  const chat = model.startChat({
    history: messages.slice(0, -1).map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
  });

  const lastMessage = messages[messages.length - 1];
  const result = await chat.sendMessageStream(lastMessage.content);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

export async function generateStructuredResponse(
  apiKey: string,
  systemPrompt: string,
  messages: { role: "user" | "model"; content: string }[]
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const chat = model.startChat({
    history: messages.slice(0, -1).map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
  });

  const lastMessage = messages[messages.length - 1];
  const result = await chat.sendMessage(lastMessage.content);
  return result.response.text();
}
