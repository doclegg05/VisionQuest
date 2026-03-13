import { GoogleGenerativeAI } from "@google/generative-ai";

export function getModel(apiKey: string) {
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
}

export async function generateResponse(
  apiKey: string,
  systemPrompt: string,
  messages: { role: "user" | "model"; content: string }[]
) {
  const model = getModel(apiKey);

  const chat = model.startChat({
    systemInstruction: systemPrompt,
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
  const model = getModel(apiKey);

  const chat = model.startChat({
    systemInstruction: systemPrompt,
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
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const chat = model.startChat({
    systemInstruction: systemPrompt,
    history: messages.slice(0, -1).map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
  });

  const lastMessage = messages[messages.length - 1];
  const result = await chat.sendMessage(lastMessage.content);
  return result.response.text();
}
