import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { invalidate } from "./cache";
import { pinnedLocalModel } from "./ai/local-model";
import type { LocalAiProviderConfig } from "./ai/local-config";

let createAvailabilityMonitor: typeof import("./sage-availability").createAvailabilityMonitor;
let getSageAvailability: typeof import("./sage-availability").getSageAvailability;
let provider = "local";
let key: string | null = null;
let config: LocalAiProviderConfig;
before(async () => {
  mock.module("./system-config", { namedExports: {
    getPlainConfigValue: async () => provider,
    getConfigValue: async () => key,
  } });
  const realLocal = await import("./ai/local-config");
  mock.module("./ai/local-config", { namedExports: { ...realLocal, readLocalAiProviderConfig: async () => config } });
  ({ createAvailabilityMonitor, getSageAvailability } = await import("./sage-availability"));
});

describe("Sage outage alarm", () => {
  it("alarms once after five minutes and rearms only after recovery", () => {
    let time = 0;
    const alarms = mock.fn();
    const observe = createAvailabilityMonitor(() => time, alarms);
    observe(false);
    time = 299_999; observe(false); assert.equal(alarms.mock.callCount(), 0);
    time = 300_000; observe(false); assert.equal(alarms.mock.callCount(), 1);
    time = 600_000; observe(false); assert.equal(alarms.mock.callCount(), 1);
    observe(true); observe(false);
    time = 900_000; observe(false); assert.equal(alarms.mock.callCount(), 2);
  });
});

describe("configured Sage connection", () => {
  const envNames = ["VQ_MAC_RELAY_ENABLED", "COHORT_DEMO_MODE", "COHORT_DEMO_LOCAL_ONLY", "AI_LOCAL_ONLY", "AI_LOCAL_APPROVED_ORIGIN", "COHORT_DEMO_LOCAL_AI_ORIGIN"];
  const original = new Map(envNames.map((name) => [name, process.env[name]]));
  beforeEach(() => {
    for (const name of envNames) delete process.env[name];
    invalidate("sage:availability");
    provider = "local"; key = null;
    config = {
      url: "http://127.0.0.1:11434", model: pinnedLocalModel(), embeddingModel: null,
      authMode: "bearer", apiStyle: "ollama", apiKey: "synthetic-test-token", apiKeySource: "config",
      numCtxRaw: null, reasoningRaw: null, maxOutputTokensRaw: null,
      cloudflareAccessClientId: null, cloudflareAccessClientIdSource: null,
      cloudflareAccessClientSecret: null, cloudflareAccessClientSecretSource: null,
    };
  });
  afterEach(() => {
    mock.restoreAll(); invalidate("sage:availability");
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  for (const apiStyle of ["ollama", "openai"] as const) {
    it(`requires the pinned model in ${apiStyle} discovery and sends no prompt`, async () => {
      config.apiStyle = apiStyle;
      const request = mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
        assert.equal(url, `http://127.0.0.1:11434/${apiStyle === "openai" ? "v1/models" : "api/tags"}`);
        assert.equal(options?.body, undefined);
        assert.equal(new Headers(options?.headers).get("authorization"), "Bearer synthetic-test-token");
        assert.equal(options?.redirect, "error");
        return Response.json(apiStyle === "openai" ? { data: [{ id: pinnedLocalModel() }] } : { models: [{ name: pinnedLocalModel() }] });
      });
      assert.equal((await getSageAvailability()).connected, true);
      request.mock.mockImplementation(async () => Response.json({ models: [{ name: "wrong-model" }], data: [{ id: "wrong-model" }] }));
      invalidate("sage:availability");
      assert.equal((await getSageAvailability()).connected, false);
    });
  }
  it("refuses an unapproved local-only origin before making a request", async () => {
    process.env.AI_LOCAL_ONLY = "true";
    process.env.AI_LOCAL_APPROVED_ORIGIN = "http://localhost:9999";
    const request = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
    assert.equal((await getSageAvailability()).connected, false);
    assert.equal(request.mock.callCount(), 0);
  });
  it("checks the configured cloud model with the platform key and no student data", async () => {
    provider = "cloud"; key = "synthetic-platform-key";
    const request = mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
      assert.match(String(url), /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//);
      assert.equal(options?.body, undefined);
      assert.equal(new Headers(options?.headers).get("x-goog-api-key"), key);
      return Response.json({});
    });
    assert.equal((await getSageAvailability()).connected, true);
    assert.equal(request.mock.callCount(), 1);
  });
});

describe("Sage public connection flag", () => {
  const original = process.env.VQ_MAC_RELAY_ENABLED;
  beforeEach(() => { process.env.VQ_MAC_RELAY_ENABLED = "true"; invalidate("sage:availability"); });
  afterEach(() => {
    mock.restoreAll(); invalidate("sage:availability");
    if (original === undefined) delete process.env.VQ_MAC_RELAY_ENABLED;
    else process.env.VQ_MAC_RELAY_ENABLED = original;
  });
  for (const connected of [true, false]) {
    it(`reports the relay connection as ${connected} without generating text`, async () => {
      const request = mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
        assert.equal(url, "http://127.0.0.1:11437/health");
        assert.equal(options?.redirect, "error");
        assert.equal(options?.body, undefined);
        return Response.json({ connected, privateValue: "must not leave server" });
      });
      const result = await getSageAvailability();
      assert.equal(result.connected, connected);
      assert.deepEqual(Object.keys(result).sort(), ["checkedAt", "connected"]);
      await getSageAvailability(); assert.equal(request.mock.callCount(), 1);
    });
  }
  it("a failed connection has no leaked endpoint or error text", async () => {
    mock.method(globalThis, "fetch", async () => { throw new Error("private endpoint and token"); });
    const result = await getSageAvailability();
    assert.equal(result.connected, false);
    assert.doesNotMatch(JSON.stringify(result), /private|token|endpoint/);
  });
});
