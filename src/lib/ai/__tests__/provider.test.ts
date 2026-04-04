import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/system-config", () => ({
  getPlainConfigValue: vi.fn(),
  getConfigValue: vi.fn(),
}));

vi.mock("@/lib/chat/api-key", () => ({
  resolveApiKey: vi.fn(),
}));

import { getProvider } from "../provider";
import { getPlainConfigValue } from "@/lib/system-config";
import { resolveApiKey } from "@/lib/chat/api-key";
import { OllamaProvider } from "../ollama-provider";
import { GeminiProvider } from "../gemini-provider";

const mockGetPlain = vi.mocked(getPlainConfigValue);
const mockResolveKey = vi.mocked(resolveApiKey);

describe("getProvider", () => {
  beforeEach(() => {
    mockGetPlain.mockReset();
    mockResolveKey.mockReset();
  });

  it("returns GeminiProvider when ai_provider is 'cloud'", async () => {
    mockGetPlain.mockImplementation(async (key) => {
      if (key === "ai_provider") return "cloud";
      return null;
    });
    mockResolveKey.mockResolvedValueOnce("test-gemini-key");

    const provider = await getProvider("student-123");
    expect(provider).toBeInstanceOf(GeminiProvider);
    expect(provider.name).toBe("gemini");
  });

  it("returns GeminiProvider when ai_provider is not set (default)", async () => {
    mockGetPlain.mockResolvedValue(null);
    mockResolveKey.mockResolvedValueOnce("test-gemini-key");

    const provider = await getProvider("student-123");
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it("returns OllamaProvider when ai_provider is 'local'", async () => {
    mockGetPlain.mockImplementation(async (key) => {
      if (key === "ai_provider") return "local";
      if (key === "ai_provider_url") return "http://localhost:11434";
      if (key === "ai_provider_model") return "gemma4:26b";
      return null;
    });

    const provider = await getProvider("student-123");
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider.name).toBe("ollama");
  });

  it("throws when local provider has no URL configured", async () => {
    mockGetPlain.mockImplementation(async (key) => {
      if (key === "ai_provider") return "local";
      return null;
    });

    await expect(getProvider("student-123")).rejects.toThrow(
      "Local AI server URL is not configured",
    );
  });
});
