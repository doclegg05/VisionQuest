import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

type ConfigKey = string;

const mockGetPlainConfigValue = mock.fn<(key: ConfigKey) => Promise<string | null>>();
const mockGetConfigValue = mock.fn<(key: ConfigKey) => Promise<string | null>>();

mock.module("@/lib/system-config", {
  namedExports: {
    getPlainConfigValue: mockGetPlainConfigValue,
    getConfigValue: mockGetConfigValue,
  },
});

let readLocalAiProviderConfig: typeof import("../local-config").readLocalAiProviderConfig;
let resolveLocalAiApiStyle: typeof import("../local-config").resolveLocalAiApiStyle;

before(async () => {
  const mod = await import("../local-config");
  readLocalAiProviderConfig = mod.readLocalAiProviderConfig;
  resolveLocalAiApiStyle = mod.resolveLocalAiApiStyle;
});

const originalEnv = { ...process.env };

describe("local-config apiStyle", () => {
  beforeEach(() => {
    mockGetPlainConfigValue.mock.resetCalls();
    mockGetConfigValue.mock.resetCalls();
    mockGetPlainConfigValue.mock.mockImplementation(async () => null);
    mockGetConfigValue.mock.mockImplementation(async () => null);
    delete process.env.AI_PROVIDER_API_STYLE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("resolveLocalAiApiStyle", () => {
    it("defaults to 'ollama' for null/undefined/unknown values", () => {
      assert.equal(resolveLocalAiApiStyle(null), "ollama");
      assert.equal(resolveLocalAiApiStyle(undefined), "ollama");
      assert.equal(resolveLocalAiApiStyle("lmstudio"), "ollama");
      assert.equal(resolveLocalAiApiStyle(""), "ollama");
    });

    it("returns 'openai' only for the exact value 'openai'", () => {
      assert.equal(resolveLocalAiApiStyle("openai"), "openai");
    });
  });

  describe("readLocalAiProviderConfig", () => {
    it("defaults apiStyle to 'ollama' when SystemConfig and env are both unset", async () => {
      const config = await readLocalAiProviderConfig();
      assert.equal(config.apiStyle, "ollama");
    });

    it("reads apiStyle from SystemConfig 'ai_provider_api_style'", async () => {
      mockGetPlainConfigValue.mock.mockImplementation(async (key: ConfigKey) =>
        key === "ai_provider_api_style" ? "openai" : null,
      );

      const config = await readLocalAiProviderConfig();
      assert.equal(config.apiStyle, "openai");
    });

    it("falls back to the AI_PROVIDER_API_STYLE env var when SystemConfig is unset", async () => {
      process.env.AI_PROVIDER_API_STYLE = "openai";

      const config = await readLocalAiProviderConfig();
      assert.equal(config.apiStyle, "openai");
    });

    it("prefers SystemConfig over the env var when both are set", async () => {
      process.env.AI_PROVIDER_API_STYLE = "openai";
      mockGetPlainConfigValue.mock.mockImplementation(async (key: ConfigKey) =>
        key === "ai_provider_api_style" ? "ollama" : null,
      );

      const config = await readLocalAiProviderConfig();
      assert.equal(config.apiStyle, "ollama");
    });
  });
});
