import { describe, it, beforeEach, before, mock } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// VQ-R-002 / VQ-R-003 — document-PII tasks are hard-gated to the local provider.
//
// CLAUDE.md and .claude/rules/sage-ai.md promised that student_record and
// staff_entered prompts were "local-only per FERPA policy". resolveAiProvider
// did not enforce that: it routed those sensitivities to the local provider
// ONLY when the ai_provider config row said "local", and an unset row defaults
// to "cloud". A fresh environment, a wiped config, or a typo therefore sent a
// TANF/SNAP recipient's full resume text — name, address, phone, employment
// history — to Gemini while the docs said it could not happen.
//
// Owner decision 2026-07-24, "fail closed for uploads only": the document/PII
// tasks hard-gate to local and 503 when it is unavailable; chat may use cloud
// with consent and audit, so a local outage never takes chat down. Gating keys
// off TASK, not sensitivity, because sage_staff_chat carries staff_entered —
// gating by sensitivity would take staff chat offline too, which is exactly
// what the decision rejected.
// ---------------------------------------------------------------------------

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
let DOCUMENT_LOCAL_ONLY_TASKS: Awaited<typeof import("../provider")>["DOCUMENT_LOCAL_ONLY_TASKS"];
let OllamaProvider: Awaited<typeof import("../ollama-provider")>["OllamaProvider"];
let GeminiProvider: Awaited<typeof import("../gemini-provider")>["GeminiProvider"];

before(async () => {
  const providerMod = await import("../provider");
  resolveAiProvider = providerMod.resolveAiProvider;
  DOCUMENT_LOCAL_ONLY_TASKS = providerMod.DOCUMENT_LOCAL_ONLY_TASKS;
  OllamaProvider = (await import("../ollama-provider")).OllamaProvider;
  GeminiProvider = (await import("../gemini-provider")).GeminiProvider;
});

/** ai_provider unset — the real-world default that used to fail open to cloud. */
function configUnset() {
  mockGetPlain.mock.mockImplementation(async () => null);
  mockGetConfig.mock.mockImplementation(async () => null);
  mockResolveKey.mock.mockImplementation(async () => "test-gemini-key");
}

function configCloud() {
  mockGetPlain.mock.mockImplementation(async (key: string) =>
    key === "ai_provider" ? "cloud" : null,
  );
  mockGetConfig.mock.mockImplementation(async () => null);
  mockResolveKey.mock.mockImplementation(async () => "test-gemini-key");
}

function configLocal() {
  mockGetPlain.mock.mockImplementation(async (key: string) => {
    if (key === "ai_provider") return "local";
    if (key === "ai_provider_url") return "https://llm.example.com";
    if (key === "ai_provider_model") return "gemma4:26b";
    return null;
  });
  mockGetConfig.mock.mockImplementation(async () => null);
}

describe("document-PII tasks fail closed (VQ-R-002, VQ-R-003)", () => {
  beforeEach(() => {
    mockGetPlain.mock.resetCalls();
    mockGetConfig.mock.resetCalls();
    mockResolveKey.mock.resetCalls();
  });

  it("names the gated tasks explicitly", () => {
    // The gate is a fixed allowlist so adding a document task is a deliberate
    // act, not an accident of sensitivity inference.
    assert.deepEqual([...DOCUMENT_LOCAL_ONLY_TASKS].sort(), [
      "chat_file_gist",
      "resume_assist",
      "resume_extract",
      "tailor_application",
    ]);
  });

  for (const task of ["resume_extract", "resume_assist", "tailor_application", "chat_file_gist"] as const) {
    it(`refuses to send ${task} to cloud when ai_provider is unset`, async () => {
      configUnset();

      await assert.rejects(
        () => resolveAiProvider({ studentId: "student-123", task, sensitivity: "student_record" }),
        /local/i,
        `${task} must fail closed, not fall through to Gemini`,
      );
      assert.equal(
        mockResolveKey.mock.callCount(),
        0,
        "a cloud API key must never even be resolved for a gated task",
      );
    });

    it(`refuses to send ${task} to cloud when ai_provider is explicitly 'cloud'`, async () => {
      configCloud();

      await assert.rejects(
        () => resolveAiProvider({ studentId: "student-123", task, sensitivity: "student_record" }),
        /local/i,
      );
      assert.equal(mockResolveKey.mock.callCount(), 0);
    });

    it(`routes ${task} to the local provider when one is configured`, async () => {
      configLocal();

      const provider = await resolveAiProvider({
        studentId: "student-123",
        task,
        sensitivity: "student_record",
      });

      assert.ok(provider instanceof OllamaProvider);
      assert.equal(mockResolveKey.mock.callCount(), 0);
    });
  }

  it("keeps student chat on cloud when configured, so a local outage cannot take chat down", async () => {
    configCloud();

    const provider = await resolveAiProvider({
      studentId: "student-123",
      task: "sage_student_chat",
      sensitivity: "student_record",
    });

    assert.ok(provider instanceof GeminiProvider);
  });

  it("keeps staff chat on cloud when configured, even though it is staff_entered", async () => {
    // Gating by sensitivity would have caught this task and taken staff chat
    // offline whenever the local server was down. The decision explicitly
    // rejected that, so this assertion guards the chosen scope.
    configCloud();

    const provider = await resolveAiProvider({
      studentId: "teacher-1",
      task: "sage_staff_chat",
      sensitivity: "staff_entered",
    });

    assert.ok(provider instanceof GeminiProvider);
  });

  it("still routes chat to local when ai_provider is 'local'", async () => {
    configLocal();

    const provider = await resolveAiProvider({
      studentId: "student-123",
      task: "sage_student_chat",
      sensitivity: "student_record",
    });

    assert.ok(provider instanceof OllamaProvider);
  });

  it("fails closed with an actionable message naming where to configure the server", async () => {
    configUnset();

    await assert.rejects(
      () =>
        resolveAiProvider({
          studentId: "student-123",
          task: "resume_extract",
          sensitivity: "student_record",
        }),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.match(message, /Program Setup/i, "the operator needs to know where to fix it");
        return true;
      },
    );
  });
});
