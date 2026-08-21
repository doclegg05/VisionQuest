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
let resolveRoleModel: typeof import("../local-config").resolveRoleModel;
let readLocalAiRoleModels: typeof import("../local-config").readLocalAiRoleModels;
let readLocalAiRoleModelSources: typeof import("../local-config").readLocalAiRoleModelSources;

before(async () => {
  const mod = await import("../local-config");
  readLocalAiProviderConfig = mod.readLocalAiProviderConfig;
  resolveLocalAiApiStyle = mod.resolveLocalAiApiStyle;
  resolveRoleModel = mod.resolveRoleModel;
  readLocalAiRoleModels = mod.readLocalAiRoleModels;
  readLocalAiRoleModelSources = mod.readLocalAiRoleModelSources;
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

/**
 * Role model resolution.
 *
 * `resolveRoleModel` is the single place the admin surface, the bake-off and
 * the provider factory agree on which model a role uses — its docstring says
 * so. Replacing its body with `return globalModel` (destroying its entire
 * purpose) previously left every other suite green, so it needs its own.
 */
describe("role model resolution", () => {
  const ROLE_ENV = [
    "AI_PROVIDER_MODEL_CHAT",
    "AI_PROVIDER_MODEL_EXTRACT",
    "AI_PROVIDER_MODEL_DOCUMENT",
    "AI_PROVIDER_MODEL_DRAFT",
  ];

  beforeEach(() => {
    mockGetPlainConfigValue.mock.resetCalls();
    mockGetPlainConfigValue.mock.mockImplementation(async () => null);
    for (const name of ROLE_ENV) delete process.env[name];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("resolveRoleModel", () => {
    it("prefers the role's own model", () => {
      assert.equal(
        resolveRoleModel("extract", { extract: "gemma4:e4b" }, "gemma4:26b"),
        "gemma4:e4b",
      );
    });

    it("falls back to the global model when the role has none", () => {
      assert.equal(resolveRoleModel("extract", {}, "gemma4:26b"), "gemma4:26b");
      assert.equal(resolveRoleModel("extract", { extract: null }, "gemma4:26b"), "gemma4:26b");
    });

    it("treats a whitespace-only override as unset", () => {
      assert.equal(resolveRoleModel("extract", { extract: "   " }, "gemma4:26b"), "gemma4:26b");
    });

    it("uses the global model when there is no role at all", () => {
      assert.equal(resolveRoleModel(null, { chat: "gemma4:31b" }, "gemma4:26b"), "gemma4:26b");
    });

    it("does not let one role's override leak into another", () => {
      const roleModels = { extract: "gemma4:e4b" };
      assert.equal(resolveRoleModel("chat", roleModels, "gemma4:26b"), "gemma4:26b");
      assert.equal(resolveRoleModel("draft", roleModels, "gemma4:26b"), "gemma4:26b");
    });
  });

  describe("readLocalAiRoleModels", () => {
    it("reads each role from its own config key", async () => {
      mockGetPlainConfigValue.mock.mockImplementation(async (key: string) =>
        key === "ai_provider_model_extract" ? "gemma4:e4b" : null,
      );

      const models = await readLocalAiRoleModels();
      assert.equal(models.extract, "gemma4:e4b");
      assert.equal(models.chat, null);
      assert.equal(models.document, null);
      assert.equal(models.draft, null);
    });

    it("falls back to the per-role environment variable", async () => {
      process.env.AI_PROVIDER_MODEL_DRAFT = "gemma4:12b";
      const models = await readLocalAiRoleModels();
      assert.equal(models.draft, "gemma4:12b");
    });

    it("lets a stored config value win over the environment", async () => {
      process.env.AI_PROVIDER_MODEL_DRAFT = "from-env";
      mockGetPlainConfigValue.mock.mockImplementation(async (key: string) =>
        key === "ai_provider_model_draft" ? "from-config" : null,
      );
      const models = await readLocalAiRoleModels();
      assert.equal(models.draft, "from-config");
    });
  });

  describe("readLocalAiRoleModelSources", () => {
    it("reports where each role's model came from", async () => {
      // The admin panel uses this to tell the operator that clearing a field
      // will not unset an env-pinned role.
      process.env.AI_PROVIDER_MODEL_DOCUMENT = "gemma4:12b";
      mockGetPlainConfigValue.mock.mockImplementation(async (key: string) =>
        key === "ai_provider_model_extract" ? "gemma4:e4b" : null,
      );

      const sources = await readLocalAiRoleModelSources();
      assert.equal(sources.extract, "config");
      assert.equal(sources.document, "env");
      assert.equal(sources.chat, null);
    });
  });
});
