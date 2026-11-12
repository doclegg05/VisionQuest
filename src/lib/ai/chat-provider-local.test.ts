import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// E2.3: the chat page hides the canned opener when Sage runs on the local
// model. The page gets one boolean from the server; this is that boolean, and
// it must agree with resolveAiProvider for a chat turn.

const config: Record<string, string> = {};
mock.module("@/lib/system-config", {
  namedExports: {
    getPlainConfigValue: async (key: string) => config[key] ?? null,
    getConfigValue: async () => null,
  },
});

let isChatProviderLocal: typeof import("./provider").isChatProviderLocal;

before(async () => {
  ({ isChatProviderLocal } = await import("./provider"));
});

const LOCAL_ENVS = ["COHORT_DEMO_MODE", "COHORT_DEMO_LOCAL_ONLY", "VQ_MAC_RELAY_ENABLED", "AI_LOCAL_ONLY"];

beforeEach(() => {
  for (const key of Object.keys(config)) delete config[key];
  for (const key of LOCAL_ENVS) delete process.env[key];
});

describe("isChatProviderLocal", () => {
  it("is false when ai_provider is unset or cloud", async () => {
    assert.equal(await isChatProviderLocal(), false);
    config.ai_provider = "cloud";
    assert.equal(await isChatProviderLocal(), false);
  });

  it("is true when ai_provider is local", async () => {
    config.ai_provider = "local";
    assert.equal(await isChatProviderLocal(), true);
  });

  for (const key of ["COHORT_DEMO_LOCAL_ONLY", "VQ_MAC_RELAY_ENABLED", "AI_LOCAL_ONLY"]) {
    it(`is true when ${key} forces local, whatever ai_provider says`, async () => {
      config.ai_provider = "cloud";
      process.env[key] = "true";
      assert.equal(await isChatProviderLocal(), true);
    });
  }

  it("returns a plain boolean, never a provider name or URL", async () => {
    config.ai_provider = "local";
    config.ai_provider_url = "http://localhost:11434";
    assert.equal(typeof (await isChatProviderLocal()), "boolean");
  });
});
