import { describe, it, beforeEach, before, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Per-role local model selection.
 *
 * Before roles existed, every generative call — a student's coaching turn, a
 * background goal extraction, a resume parse — was served by the single model
 * named in `ai_provider_model`. These tests pin the four properties that make
 * the per-role layer safe to turn on:
 *
 *  1. An unconfigured role behaves exactly as it did before (global model).
 *  2. A configured role gets its own model.
 *  3. FERPA routing is untouched — a role can never move a student_record
 *     call to the cloud, nor keep a public call off it.
 *  4. A background role running a SECOND model gets a short keep-alive, so it
 *     cannot hold unified memory against the model students are waiting on.
 */

const mockGetPlain = mock.fn<(key: string) => Promise<string | null>>();
const mockGetConfig = mock.fn<(key: string) => Promise<string | null>>();
const mockResolveKey = mock.fn<(studentId: string) => Promise<string>>();

mock.module("@/lib/system-config", {
  namedExports: {
    getPlainConfigValue: mockGetPlain,
    getConfigValue: mockGetConfig,
  },
});

mock.module("@/lib/chat/api-key", {
  namedExports: {
    resolveApiKey: mockResolveKey,
  },
});

let resolveAiProvider: Awaited<typeof import("../provider")>["resolveAiProvider"];
let getProvider: Awaited<typeof import("../provider")>["getProvider"];
let OllamaProvider: Awaited<typeof import("../ollama-provider")>["OllamaProvider"];
let GeminiProvider: Awaited<typeof import("../gemini-provider")>["GeminiProvider"];

before(async () => {
  const providerMod = await import("../provider");
  const ollamaMod = await import("../ollama-provider");
  const geminiMod = await import("../gemini-provider");
  resolveAiProvider = providerMod.resolveAiProvider;
  getProvider = providerMod.getProvider;
  OllamaProvider = ollamaMod.OllamaProvider;
  GeminiProvider = geminiMod.GeminiProvider;
});

/** Reach the private fields the factory sets — same approach as provider.test.ts. */
function modelOf(provider: unknown): string {
  return (provider as { model: string }).model;
}
function keepAliveOf(provider: unknown): string {
  return (provider as { keepAlive: string }).keepAlive;
}

function localConfig(overrides: Record<string, string> = {}) {
  return async (key: string): Promise<string | null> => {
    const base: Record<string, string> = {
      ai_provider: "local",
      ai_provider_url: "http://localhost:11434",
      ai_provider_model: "gemma4:26b",
    };
    return { ...base, ...overrides }[key] ?? null;
  };
}

/**
 * Env fallbacks are read when SystemConfig has no value; keep them out.
 *
 * MUST await `run()` before restoring. The subject is async and reads the
 * environment inside its own awaits, so a synchronous wrapper would put every
 * variable back before the first config read — isolation in appearance only.
 * Verified: with the sync version and AI_PROVIDER_MODEL_EXTRACT set in the
 * ambient environment, this file went 14 pass / 4 fail.
 */
async function withoutEnv<T>(names: readonly string[], run: () => Promise<T>): Promise<T> {
  const saved = names.map((name) => [name, process.env[name]] as const);
  for (const name of names) delete process.env[name];
  try {
    return await run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const ROLE_MODEL_ENV = [
  "AI_PROVIDER_MODEL_CHAT",
  "AI_PROVIDER_MODEL_EXTRACT",
  "AI_PROVIDER_MODEL_DOCUMENT",
  "AI_PROVIDER_MODEL_DRAFT",
];

function withoutRoleEnv<T>(run: () => Promise<T>): Promise<T> {
  return withoutEnv(ROLE_MODEL_ENV, run);
}

describe("per-role local model selection", () => {
  beforeEach(() => {
    mockGetPlain.mock.resetCalls();
    mockGetConfig.mock.resetCalls();
    mockResolveKey.mock.resetCalls();
    mockGetConfig.mock.mockImplementation(async () => null);
  });

  it("uses the global model when the role has no override", async () => {
    mockGetPlain.mock.mockImplementation(localConfig());

    const provider = await withoutRoleEnv(() =>
      resolveAiProvider({
        studentId: "student-123",
        task: "sage_student_chat",
        sensitivity: "student_record",
      }),
    );

    assert.ok(provider instanceof OllamaProvider);
    assert.equal(modelOf(provider), "gemma4:26b");
  });

  it("uses the role's model when one is configured", async () => {
    mockGetPlain.mock.mockImplementation(
      localConfig({ ai_provider_model_extract: "gemma4:e4b" }),
    );

    const provider = await withoutRoleEnv(() =>
      resolveAiProvider({
        studentId: "student-123",
        task: "sage_post_response",
        sensitivity: "student_record",
      }),
    );

    assert.equal(modelOf(provider), "gemma4:e4b");
  });

  it("leaves other roles on the global model when only one role is overridden", async () => {
    mockGetPlain.mock.mockImplementation(
      localConfig({ ai_provider_model_extract: "gemma4:e4b" }),
    );

    const chat = await withoutRoleEnv(() =>
      resolveAiProvider({
        studentId: "student-123",
        task: "sage_student_chat",
        sensitivity: "student_record",
      }),
    );

    assert.equal(modelOf(chat), "gemma4:26b");
  });

  it("honors an explicit role override on the request", async () => {
    mockGetPlain.mock.mockImplementation(
      localConfig({ ai_provider_model_draft: "gemma4:12b" }),
    );

    // sage_post_response maps to "extract" by default; a call site that
    // generates prose under that task can say so.
    const provider = await withoutRoleEnv(() =>
      resolveAiProvider({
        studentId: "student-123",
        task: "sage_post_response",
        sensitivity: "student_record",
        role: "draft",
      }),
    );

    assert.equal(modelOf(provider), "gemma4:12b");
  });

  it("falls back to the global model for an unclassified task", async () => {
    mockGetPlain.mock.mockImplementation(
      localConfig({
        ai_provider_model_chat: "gemma4:31b",
        ai_provider_model_extract: "gemma4:e4b",
      }),
    );

    const provider = await withoutRoleEnv(() =>
      resolveAiProvider({
        studentId: "student-123",
        task: "legacy",
        sensitivity: "student_record",
      }),
    );

    assert.equal(modelOf(provider), "gemma4:26b");
  });

  it("reads the role model from the environment when SystemConfig is unset", async () => {
    mockGetPlain.mock.mockImplementation(localConfig());
    const previous = process.env.AI_PROVIDER_MODEL_EXTRACT;
    process.env.AI_PROVIDER_MODEL_EXTRACT = "gemma4:e2b";
    try {
      const provider = await resolveAiProvider({
        studentId: "student-123",
        task: "sage_post_response",
        sensitivity: "student_record",
      });
      assert.equal(modelOf(provider), "gemma4:e2b");
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER_MODEL_EXTRACT;
      else process.env.AI_PROVIDER_MODEL_EXTRACT = previous;
    }
  });

  it("passes the role through getProvider for non-sensitive local calls", async () => {
    mockGetPlain.mock.mockImplementation(
      localConfig({ ai_provider_model_document: "gemma4:12b" }),
    );

    const provider = await withoutRoleEnv(() => getProvider("student-123", "document"));
    assert.equal(modelOf(provider), "gemma4:12b");
  });
});

describe("per-role keep-alive (memory residency)", () => {
  beforeEach(() => {
    mockGetPlain.mock.resetCalls();
    mockGetConfig.mock.resetCalls();
    mockGetConfig.mock.mockImplementation(async () => null);
  });

  it("keeps the interactive chat model resident for the workday", async () => {
    mockGetPlain.mock.mockImplementation(
      localConfig({ ai_provider_model_chat: "gemma4:31b" }),
    );

    const provider = await withoutRoleEnv(() =>
      resolveAiProvider({
        studentId: "student-123",
        task: "sage_student_chat",
        sensitivity: "student_record",
      }),
    );

    assert.equal(keepAliveOf(provider), "8h");
  });

  it("gives a background role on a DIFFERENT model the short keep-alive", async () => {
    mockGetPlain.mock.mockImplementation(
      localConfig({
        ai_provider_model_chat: "gemma4:31b",
        ai_provider_model_extract: "gemma4:e4b",
      }),
    );

    const provider = await withoutRoleEnv(() =>
      resolveAiProvider({
        studentId: "student-123",
        task: "sage_post_response",
        sensitivity: "student_record",
      }),
    );

    assert.equal(modelOf(provider), "gemma4:e4b");
    assert.equal(keepAliveOf(provider), OllamaProvider.SECONDARY_KEEP_ALIVE);
    assert.notEqual(OllamaProvider.SECONDARY_KEEP_ALIVE, "8h");
  });

  it("keeps the long keep-alive when a background role shares the chat model", async () => {
    // The single-model deployment must be byte-identical to pre-roles
    // behavior: nothing gets evicted early just because roles exist.
    mockGetPlain.mock.mockImplementation(localConfig());

    const provider = await withoutRoleEnv(() =>
      resolveAiProvider({
        studentId: "student-123",
        task: "sage_post_response",
        sensitivity: "student_record",
      }),
    );

    assert.equal(modelOf(provider), "gemma4:26b");
    assert.equal(keepAliveOf(provider), "8h");
  });

  it("does not shorten the chat model's residency via an alias of itself", async () => {
    // "gemma4" and "gemma4:latest" are ONE loaded model on the server, and
    // keep_alive is applied per model. A raw string compare would call them
    // different and attach the 5m timer to the model students wait on.
    mockGetPlain.mock.mockImplementation(
      localConfig({
        ai_provider_model: "gemma4:latest",
        ai_provider_model_extract: "gemma4",
      }),
    );

    const provider = await withoutRoleEnv(() =>
      resolveAiProvider({
        studentId: "student-123",
        task: "sage_post_response",
        sensitivity: "student_record",
      }),
    );

    assert.equal(modelOf(provider), "gemma4");
    assert.equal(keepAliveOf(provider), "8h");
  });

  it("compares against the chat role's model, not the global default", async () => {
    // chat is overridden and extract is not: extract resolves to the GLOBAL
    // model, which differs from chat's — so it is secondary weight.
    mockGetPlain.mock.mockImplementation(
      localConfig({ ai_provider_model_chat: "gemma4:31b" }),
    );

    const provider = await withoutRoleEnv(() =>
      resolveAiProvider({
        studentId: "student-123",
        task: "sage_post_response",
        sensitivity: "student_record",
      }),
    );

    assert.equal(modelOf(provider), "gemma4:26b");
    assert.equal(keepAliveOf(provider), OllamaProvider.SECONDARY_KEEP_ALIVE);
  });
});

describe("roles never change FERPA routing", () => {
  beforeEach(() => {
    mockGetPlain.mock.resetCalls();
    mockGetConfig.mock.resetCalls();
    mockResolveKey.mock.resetCalls();
    mockGetConfig.mock.mockImplementation(async () => null);
  });

  it("still routes student_record to the local provider regardless of role config", async () => {
    mockGetPlain.mock.mockImplementation(
      localConfig({ ai_provider_model_extract: "gemma4:e4b" }),
    );

    const provider = await withoutRoleEnv(() =>
      resolveAiProvider({
        studentId: "student-123",
        task: "sage_post_response",
        sensitivity: "student_record",
      }),
    );

    assert.ok(provider instanceof OllamaProvider);
  });

  it("ignores role model overrides entirely on the cloud provider", async () => {
    mockGetPlain.mock.mockImplementation(async (key: string) => {
      if (key === "ai_provider") return "cloud";
      if (key === "ai_provider_model_chat") return "gemma4:31b";
      return null;
    });
    mockResolveKey.mock.mockImplementation(async () => "test-gemini-key");

    const provider = await withoutRoleEnv(() =>
      resolveAiProvider({
        studentId: "student-123",
        task: "sage_student_chat",
        sensitivity: "student_record",
      }),
    );

    // The FERPA soft-switch still hands student_record to Gemini when the
    // operator has selected the cloud provider; a role model cannot override
    // that decision in either direction.
    assert.ok(provider instanceof GeminiProvider);
  });
});

describe("per-role output budget", () => {
  beforeEach(() => {
    mockGetPlain.mock.resetCalls();
    mockGetConfig.mock.resetCalls();
    mockGetConfig.mock.mockImplementation(async () => null);
  });

  function maxOutputOf(provider: unknown): number {
    return (provider as { maxOutputTokens: number }).maxOutputTokens;
  }
  function structuredMaxOf(provider: unknown): number {
    return (provider as { structuredMaxOutputTokens: number }).structuredMaxOutputTokens;
  }

  function withoutCapEnv<T>(run: () => Promise<T>): Promise<T> {
    return withoutEnv(
      [
        "AI_PROVIDER_MAX_OUTPUT_TOKENS",
        "AI_PROVIDER_MAX_OUTPUT_TOKENS_CHAT",
        "AI_PROVIDER_MAX_OUTPUT_TOKENS_EXTRACT",
        "AI_PROVIDER_MAX_OUTPUT_TOKENS_DOCUMENT",
        "AI_PROVIDER_MAX_OUTPUT_TOKENS_DRAFT",
        ...ROLE_MODEL_ENV,
      ],
      run,
    );
  }

  it("keeps the provider defaults when no role cap is set", async () => {
    mockGetPlain.mock.mockImplementation(localConfig());

    const provider = await withoutCapEnv(() =>
      withoutRoleEnv(() =>
        resolveAiProvider({
          studentId: "student-123",
          task: "resume_extract",
          sensitivity: "student_record",
        }),
      ),
    );

    assert.equal(maxOutputOf(provider), 768);
    assert.equal(structuredMaxOf(provider), 512);
  });

  it("raises both caps for a role that is given a budget", async () => {
    // The resume parse emits a whole resume object, which does not fit in the
    // 512-token structured default — a truncated parse reads as "no data".
    mockGetPlain.mock.mockImplementation(
      localConfig({ ai_provider_max_output_tokens_document: "2048" }),
    );

    const provider = await withoutCapEnv(() =>
      withoutRoleEnv(() =>
        resolveAiProvider({
          studentId: "student-123",
          task: "resume_extract",
          sensitivity: "student_record",
        }),
      ),
    );

    assert.equal(maxOutputOf(provider), 2048);
    assert.equal(structuredMaxOf(provider), 2048);
  });

  it("leaves JSON mode on its own default when only the GLOBAL cap is raised", async () => {
    // Deployments raise the global cap to make room for reasoning tokens on
    // the free-text path. That must not silently change JSON mode.
    mockGetPlain.mock.mockImplementation(
      localConfig({ ai_provider_max_output_tokens: "3072" }),
    );

    const provider = await withoutCapEnv(() =>
      withoutRoleEnv(() =>
        resolveAiProvider({
          studentId: "student-123",
          task: "resume_extract",
          sensitivity: "student_record",
        }),
      ),
    );

    assert.equal(maxOutputOf(provider), 3072);
    assert.equal(structuredMaxOf(provider), 512);
  });

  it("prefers the role cap over the global cap", async () => {
    mockGetPlain.mock.mockImplementation(
      localConfig({
        ai_provider_max_output_tokens: "3072",
        ai_provider_max_output_tokens_extract: "1024",
      }),
    );

    const provider = await withoutCapEnv(() =>
      withoutRoleEnv(() =>
        resolveAiProvider({
          studentId: "student-123",
          task: "sage_post_response",
          sensitivity: "student_record",
        }),
      ),
    );

    assert.equal(maxOutputOf(provider), 1024);
  });

  it("ignores an out-of-range role cap and falls back to the global default", async () => {
    mockGetPlain.mock.mockImplementation(
      localConfig({ ai_provider_max_output_tokens_draft: "999999" }),
    );

    const provider = await withoutCapEnv(() =>
      withoutRoleEnv(() =>
        resolveAiProvider({
          studentId: "student-123",
          task: "sage_briefing",
          sensitivity: "student_record",
        }),
      ),
    );

    assert.equal(maxOutputOf(provider), 768);
    assert.equal(structuredMaxOf(provider), 512);
  });
});
