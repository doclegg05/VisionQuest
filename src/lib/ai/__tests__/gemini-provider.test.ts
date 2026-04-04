import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMessage = vi.fn();
const sendMessageStream = vi.fn();

vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(function () {
    return {
      getGenerativeModel: vi.fn().mockReturnValue({
        startChat: vi.fn().mockReturnValue({
          sendMessage,
          sendMessageStream,
        }),
      }),
    };
  }),
}));

import { GeminiProvider } from "../gemini-provider";

describe("GeminiProvider", () => {
  const provider = new GeminiProvider("test-api-key");

  beforeEach(() => {
    sendMessage.mockReset();
    sendMessageStream.mockReset();
  });

  it("generateResponse returns text from Gemini", async () => {
    sendMessage.mockResolvedValueOnce({
      response: { text: () => "Gemini says hello" },
    });

    const result = await provider.generateResponse("Be helpful.", [
      { role: "user", content: "Hi" },
    ]);

    expect(result).toBe("Gemini says hello");
  });

  it("streamResponse yields chunks from Gemini stream", async () => {
    const mockStream = (async function* () {
      yield { text: () => "chunk1" };
      yield { text: () => "chunk2" };
    })();

    sendMessageStream.mockResolvedValueOnce({
      stream: mockStream,
    });

    const chunks: string[] = [];
    for await (const chunk of provider.streamResponse("sys", [
      { role: "user", content: "Hi" },
    ])) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["chunk1", "chunk2"]);
  });

  it("generateStructuredResponse returns JSON text", async () => {
    sendMessage.mockResolvedValueOnce({
      response: { text: () => '{"goals_found":[]}' },
    });

    const result = await provider.generateStructuredResponse("Extract.", [
      { role: "user", content: "text" },
    ]);

    expect(result).toBe('{"goals_found":[]}');
  });
});
