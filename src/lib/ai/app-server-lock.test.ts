import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, mock } from "node:test";

/**
 * The production server runs `node .next/standalone/server.js`, where
 * NEXT_RUNTIME is not set in the environment (only the `next` CLI sets it),
 * and Render's RENDER is absent off Render. So the server marks itself at
 * boot instead (src/instrumentation.ts): every eval-only OpenRouter check then
 * refuses, and the eval embedding override slot is locked empty for the life
 * of the process. This file locks the slot for good, so it runs on its own.
 */

mock.module("@/lib/system-config", {
  namedExports: { getPlainConfigValue: async () => null, getConfigValue: async () => null },
});
mock.module("@/lib/chat/api-key", {
  namedExports: { resolveApiKey: async () => "platform-key" },
});
mock.module("@/lib/ai/audit", {
  namedExports: {
    logAiAuditEvent: async () => undefined,
    getProviderClass: (name?: string | null) => (name === "ollama" ? "local" : name ? "cloud" : "none"),
    policyDecisionForProvider: () => "configured_provider",
  },
});

describe("app server boot lock", () => {
  it("marks the process as the app server, whatever the environment says", async () => {
    const { appServerMarker, markAppServer } = await import("./app-server");
    const saved = { RENDER: process.env.RENDER, NEXT_RUNTIME: process.env.NEXT_RUNTIME };
    delete process.env.RENDER;
    delete process.env.NEXT_RUNTIME;
    try {
      assert.equal(appServerMarker(), null);
      markAppServer();
      assert.ok(appServerMarker());
    } finally {
      Object.assign(process.env, Object.fromEntries(Object.entries(saved).filter(([, value]) => value !== undefined)));
    }
  });

  it("locks the override slot empty, so an install fails and the resolver serves its normal provider", async () => {
    const { EVAL_EMBEDDING_OVERRIDE_KEY, lockEvalEmbeddingOverride } = await import("./eval-embedding-override-key");
    const { resolveEmbeddingProvider } = await import("./embedding-provider");
    const intruder = { name: "openrouter", model: "google/gemini-embedding-001", embed: async () => [] };
    Reflect.set(globalThis, EVAL_EMBEDDING_OVERRIDE_KEY, intruder);
    lockEvalEmbeddingOverride();
    assert.equal(Reflect.get(globalThis, EVAL_EMBEDDING_OVERRIDE_KEY), undefined, "locking clears an earlier install");
    assert.equal(Reflect.set(globalThis, EVAL_EMBEDDING_OVERRIDE_KEY, intruder), false);
    assert.throws(() => Object.defineProperty(globalThis, EVAL_EMBEDDING_OVERRIDE_KEY, { value: intruder }));
    assert.equal(Reflect.get(globalThis, EVAL_EMBEDDING_OVERRIDE_KEY), undefined);
    lockEvalEmbeddingOverride();
    const saved = process.env.RENDER;
    delete process.env.RENDER;
    try {
      const provider = await resolveEmbeddingProvider({ sensitivity: "student_record" });
      assert.equal(provider.name, "gemini");
    } finally {
      if (saved !== undefined) process.env.RENDER = saved;
    }
  });

  it("is applied first thing in the server's Node runtime boot", () => {
    const boot = readFileSync(path.resolve("src/instrumentation.ts"), "utf8");
    const nodeBranch = boot.slice(boot.indexOf('if (process.env.NEXT_RUNTIME === "nodejs") {'));
    const mark = nodeBranch.indexOf("markAppServer();");
    const lock = nodeBranch.indexOf("lockEvalEmbeddingOverride();");
    const firstOther = Math.min(
      ...["validateRuntimeEnv()", "runBootProbes()", "sentry.server.config"].map((call) => nodeBranch.indexOf(call)),
    );
    assert.ok(mark > 0 && lock > 0, "register() must call markAppServer() and lockEvalEmbeddingOverride()");
    assert.ok(mark < firstOther && lock < firstOther, "both must run before anything else in the Node runtime boot");
  });
});
