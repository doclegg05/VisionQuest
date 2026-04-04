import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkOllamaHealth } from "../health";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("checkOllamaHealth", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns healthy when Ollama responds with models", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: "gemma4:26b" }] }),
    });

    const result = await checkOllamaHealth("http://localhost:11434");
    expect(result).toEqual({
      healthy: true,
      models: ["gemma4:26b"],
    });
  });

  it("returns unhealthy on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await checkOllamaHealth("http://localhost:11434");
    expect(result).toEqual({
      healthy: false,
      error: "Connection refused",
    });
  });

  it("returns unhealthy on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    const result = await checkOllamaHealth("http://localhost:11434");
    expect(result).toEqual({
      healthy: false,
      error: "Server returned 503",
    });
  });
});
