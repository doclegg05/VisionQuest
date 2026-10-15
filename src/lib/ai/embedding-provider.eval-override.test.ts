import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

/**
 * The memory and RAG evals embed through the app's own resolver. With no
 * Gemini key in CI, the eval harness installs an OpenRouter embedding
 * provider as an eval-only override (scripts/lib/sage-eval-provider.mjs,
 * installOpenRouterEvalEmbeddings). These tests pin the guarantee that the
 * app can never use it:
 *
 *   - nothing under src/ installs the override; only the eval harness does
 *   - the resolver refuses an installed override inside the app server
 *   - without an override the resolver behaves exactly as before
 */

const mockGetPlainConfigValue = mock.fn<(key: string) => Promise<string | null>>(async () => null);
const auditEvents: Array<Record<string, unknown>> = [];

mock.module("@/lib/system-config", {
  namedExports: {
    getPlainConfigValue: mockGetPlainConfigValue,
    getConfigValue: async () => null,
  },
});

mock.module("@/lib/chat/api-key", {
  namedExports: { resolveApiKey: async () => "platform-key" },
});

mock.module("@/lib/ai/audit", {
  namedExports: {
    logAiAuditEvent: async (event: Record<string, unknown>) => {
      auditEvents.push(event);
    },
    getProviderClass: (name?: string | null) => (name === "ollama" ? "local" : name ? "cloud" : "none"),
    policyDecisionForProvider: () => "configured_provider",
  },
});

type Resolver = typeof import("./embedding-provider");
let resolver: Resolver;
let KEY: symbol;

before(async () => {
  resolver = await import("./embedding-provider");
  KEY = (await import("./eval-embedding-override-key")).EVAL_EMBEDDING_OVERRIDE_KEY;
});

const fakeOverride = {
  name: "openrouter",
  model: "google/gemini-embedding-001",
  embed: async (texts: string[]) => texts.map(() => new Array(768).fill(0)),
};

function install(value: unknown) {
  Reflect.set(globalThis, KEY, value);
}

describe("eval-only embedding override", () => {
  beforeEach(() => {
    auditEvents.length = 0;
    mockGetPlainConfigValue.mock.mockImplementation(async () => null);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, KEY);
    delete process.env.RENDER;
    delete process.env.NEXT_RUNTIME;
  });

  it("without an override, resolves Gemini exactly as before", async () => {
    const provider = await resolver.resolveEmbeddingProvider({ sensitivity: "student_record" });
    assert.equal(provider.name, "gemini");
    assert.equal(await resolver.getActiveEmbeddingModel(), "gemini-embedding-001");
  });

  it("serves an installed override for every sensitivity, with the matching model and an audit event", async () => {
    install(fakeOverride);
    for (const sensitivity of ["student_record", "staff_entered", "system", "public_program"] as const) {
      assert.equal(await resolver.resolveEmbeddingProvider({ sensitivity, callSite: "eval" }), fakeOverride);
    }
    assert.equal(await resolver.getActiveEmbeddingModel(), "google/gemini-embedding-001");
    assert.equal(auditEvents.length, 4);
    assert.equal(auditEvents[0].providerName, "openrouter");
    assert.equal(auditEvents[0].providerClass, "cloud");
  });

  it("refuses an installed override inside the app server, and never embeds with it", async () => {
    const embed = mock.fn(fakeOverride.embed);
    install({ ...fakeOverride, embed });
    for (const marker of ["RENDER", "NEXT_RUNTIME"]) {
      process.env[marker] = "true";
      await assert.rejects(resolver.resolveEmbeddingProvider({ sensitivity: "student_record" }), /app server/);
      await assert.rejects(resolver.getActiveEmbeddingModel(), /app server/);
      delete process.env[marker];
    }
    assert.equal(embed.mock.callCount(), 0);
    assert.equal(auditEvents.length, 0);
  });

  it("refuses a value that is not an embedding provider, or one that claims another provider's name", async () => {
    install({ name: "openrouter" });
    await assert.rejects(resolver.resolveEmbeddingProvider({ sensitivity: "system" }), /not an embedding provider/);
    // An override calling itself "ollama" would be audited as local.
    install({ ...fakeOverride, name: "ollama" });
    await assert.rejects(resolver.resolveEmbeddingProvider({ sensitivity: "system" }), /OpenRouter/);
  });

  it("still obeys ai_cloud_policy=local_only, the program's strongest FERPA switch", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(async (key: string) => (key === "ai_cloud_policy" ? "local_only" : null));
    const embed = mock.fn(fakeOverride.embed);
    install({ ...fakeOverride, embed });
    await assert.rejects(resolver.resolveEmbeddingProvider({ sensitivity: "student_record" }), (error: unknown) => {
      assert.equal((error as Error).name, "AiCloudRefusedError");
      return true;
    });
    assert.equal(embed.mock.callCount(), 0);
  });
});

describe("only the eval harness can install the override", () => {
  const ROOT = path.resolve(".");
  const SRC = path.join(ROOT, "src");
  const EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
  const TESTS = /\.test\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
  // Built from the symbol itself, so a rename cannot leave the scan watching an old string.
  const keyText = () =>
    new RegExp(`${KEY.description?.replace(/\./g, "\\.")}|EVAL_EMBEDDING_OVERRIDE_KEY|eval-embedding-override-key|lockEvalEmbeddingOverride`);

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return EXTENSIONS.test(name) && !TESTS.test(name) ? [full] : [];
    });
  }

  /** src/ plus the server-side config files at the repository root (next.config, sentry configs). */
  function appFiles(): string[] {
    const rootFiles = readdirSync(ROOT)
      .filter((name) => EXTENSIONS.test(name) && !TESTS.test(name))
      .map((name) => path.join(ROOT, name));
    return [...sourceFiles(SRC), ...rootFiles];
  }

  it("is mentioned in app code only by its key module, the resolver that reads it, and the boot lock", () => {
    const mentions = appFiles()
      .filter((file) => keyText().test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file))
      .sort();
    assert.deepEqual(mentions, [
      "src/instrumentation.ts",
      "src/lib/ai/embedding-provider.ts",
      "src/lib/ai/eval-embedding-override-key.ts",
    ]);
  });

  it("is only read by the resolver and only locked at boot, never written", () => {
    const WRITES = /Reflect\.(set|defineProperty)|Object\.(defineProperty|defineProperties|assign)\(\s*globalThis|globalThis\[[^\]]+\]\s*=/;
    const resolverSource = readFileSync(path.join(SRC, "lib/ai/embedding-provider.ts"), "utf8");
    assert.match(resolverSource, /Reflect\.get\(globalThis, EVAL_EMBEDDING_OVERRIDE_KEY\)/);
    assert.doesNotMatch(resolverSource, WRITES);
    const bootSource = readFileSync(path.join(SRC, "instrumentation.ts"), "utf8");
    assert.doesNotMatch(bootSource, WRITES);
    const keySource = readFileSync(path.join(SRC, "lib/ai/eval-embedding-override-key.ts"), "utf8");
    assert.match(keySource, /writable: false,\s*configurable: false/, "the only write in app code is the boot lock");
  });

  it("is installed by the eval harness, which refuses to run next to a real database", () => {
    const harness = readFileSync(path.resolve("scripts/lib/sage-eval-provider.mjs"), "utf8");
    const installer = harness.slice(harness.indexOf("export async function installOpenRouterEvalEmbeddings"));
    assert.match(installer, /assertNoRemoteDatabase\(\)/);
    assert.match(installer, /Reflect\.set\(globalThis, EVAL_EMBEDDING_OVERRIDE_KEY/);
  });
});
