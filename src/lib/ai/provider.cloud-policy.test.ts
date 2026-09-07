import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { AiTask, DataSensitivity } from "./types";

/**
 * `resolveAiProvider` under the `ai_cloud_policy` switch.
 *
 * The first block is the regression pin: under `permissive` (the default) the
 * routing table is byte-for-byte what shipped before the switch existed. The
 * later blocks pin the two stricter policies and the AC3 rule that a
 * local-only sensitivity never resolves a student's personal Gemini key.
 */

const mockGetPlain = mock.fn<(key: string) => Promise<string | null>>();
const mockGetConfig = mock.fn<(key: string) => Promise<string | null>>();
const mockResolveKey = mock.fn<(studentId: string, opts?: unknown) => Promise<string>>();

mock.module("@/lib/system-config", {
  namedExports: { getPlainConfigValue: mockGetPlain, getConfigValue: mockGetConfig },
});
mock.module("@/lib/chat/api-key", {
  namedExports: { resolveApiKey: mockResolveKey },
});

// The Wave 2 de-identification branch calls this on every cloud resolution.
// Pinned to an empty identity here so these rows keep measuring ROUTING only:
// an empty vault leaves the provider unwrapped and writes no event, which is
// what the `deepEqual(auditEvents, [])` assertions below depend on. The
// wrapping itself is measured in provider.deidentify.test.ts.
mock.module("@/lib/ai/identity", {
  namedExports: {
    loadIdentityInput: async () => ({}),
    listManagedRosterNames: async () => [],
    MANAGED_ROSTER_CAP: 500,
    clearIdentityCache: () => {},
  },
});

const auditEvents: Record<string, unknown>[] = [];
mock.module("@/lib/ai/audit", {
  namedExports: {
    logAiAuditEvent: async (event: Record<string, unknown>) => {
      auditEvents.push(event);
    },
    getProviderClass: (name?: string | null) =>
      name === "ollama" ? "local" : name === "gemini" ? "cloud" : name ? "unknown" : "none",
    policyDecisionForProvider: (name?: string | null) =>
      name === "ollama" ? "local_only" : "configured_provider",
  },
});

let resolveAiProvider: typeof import("./provider").resolveAiProvider;
let AiCloudRefusedError: typeof import("./lanes").AiCloudRefusedError;

before(async () => {
  ({ resolveAiProvider } = await import("./provider"));
  ({ AiCloudRefusedError } = await import("./lanes"));
});

function configStore(values: Record<string, string>) {
  return async (key: string) => values[key] ?? null;
}

const LOCAL = { ai_provider: "local", ai_provider_url: "http://localhost:11434", ai_provider_model: "gemma4" };

beforeEach(() => {
  mockGetPlain.mock.resetCalls();
  mockGetConfig.mock.resetCalls();
  mockResolveKey.mock.resetCalls();
  mockGetConfig.mock.mockImplementation(async () => null);
  mockResolveKey.mock.mockImplementation(async () => "platform-key");
  delete process.env.AI_CLOUD_POLICY;
  auditEvents.length = 0;
});

describe("permissive (default) — today's routing table, pinned", () => {
  // Every row is the behaviour of resolveAiProvider at eb9a97a. A cloud row
  // means GeminiProvider, a local row OllamaProvider; nothing throws.
  const rows: {
    aiProvider: "cloud" | "local" | "unset";
    task: AiTask;
    sensitivity: DataSensitivity;
    preferCloud?: boolean;
    expect: "gemini" | "ollama";
  }[] = [
    { aiProvider: "unset", task: "sage_student_chat", sensitivity: "student_record", expect: "gemini" },
    { aiProvider: "cloud", task: "sage_student_chat", sensitivity: "student_record", expect: "gemini" },
    { aiProvider: "cloud", task: "sage_staff_chat", sensitivity: "staff_entered", expect: "gemini" },
    { aiProvider: "cloud", task: "chat_file_gist", sensitivity: "student_record", expect: "gemini" },
    { aiProvider: "cloud", task: "resume_extract", sensitivity: "student_record", expect: "gemini" },
    { aiProvider: "cloud", task: "draft_endorsement", sensitivity: "student_record", expect: "gemini" },
    { aiProvider: "cloud", task: "public_program_help", sensitivity: "public_program", expect: "gemini" },
    { aiProvider: "cloud", task: "legacy", sensitivity: "configured", expect: "gemini" },
    { aiProvider: "local", task: "sage_student_chat", sensitivity: "student_record", expect: "ollama" },
    { aiProvider: "local", task: "chat_file_gist", sensitivity: "student_record", expect: "ollama" },
    { aiProvider: "local", task: "public_program_help", sensitivity: "public_program", expect: "ollama" },
    { aiProvider: "local", task: "legacy", sensitivity: "configured", expect: "ollama" },
    // preferCloud lifts ONLY public_program off a local deployment.
    { aiProvider: "local", task: "public_program_help", sensitivity: "public_program", preferCloud: true, expect: "gemini" },
    { aiProvider: "local", task: "sage_student_chat", sensitivity: "student_record", preferCloud: true, expect: "ollama" },
    { aiProvider: "local", task: "legacy", sensitivity: "configured", preferCloud: true, expect: "ollama" },
  ];

  for (const row of rows) {
    const label = `${row.aiProvider}/${row.task}/${row.sensitivity}${row.preferCloud ? "/preferCloud" : ""} → ${row.expect}`;
    it(label, async () => {
      mockGetPlain.mock.mockImplementation(
        configStore(row.aiProvider === "local" ? LOCAL : row.aiProvider === "cloud" ? { ai_provider: "cloud" } : {}),
      );
      const provider = await resolveAiProvider({
        studentId: "student-1",
        task: row.task,
        sensitivity: row.sensitivity,
        preferCloud: row.preferCloud,
      });
      assert.equal(provider.name, row.expect);
      assert.deepEqual(auditEvents, [], "permissive writes no refusal event");
    });
  }

  it("every declared task resolves without throwing on both providers", async () => {
    const tasks: AiTask[] = [
      "legacy", "sage_student_chat", "sage_staff_chat", "sage_post_response", "sage_briefing",
      "conversation_summary", "resume_assist", "resume_extract", "tailor_application", "explain_job",
      "draft_endorsement", "public_form_lookup", "public_program_help", "chat_file_gist", "embedding",
    ];
    for (const aiProvider of ["cloud", "local"] as const) {
      mockGetPlain.mock.mockImplementation(configStore(aiProvider === "local" ? LOCAL : { ai_provider: "cloud" }));
      for (const task of tasks) {
        const provider = await resolveAiProvider({ studentId: "student-1", task, sensitivity: "student_record" });
        assert.equal(provider.name, aiProvider === "local" ? "ollama" : "gemini", `${aiProvider}/${task}`);
      }
    }
  });
});

describe("lanes", () => {
  beforeEach(() => {
    mockGetPlain.mock.mockImplementation(configStore({ ai_provider: "cloud", ai_cloud_policy: "lanes" }));
  });

  it("refuses a batch-lane task on the cloud provider, after writing a blocked audit event", async () => {
    await assert.rejects(
      resolveAiProvider({ studentId: "student-1", task: "chat_file_gist", sensitivity: "student_record" }),
      (error: unknown) => error instanceof AiCloudRefusedError && error.lane === "batch" && error.policy === "lanes",
    );
    assert.equal(mockResolveKey.mock.callCount(), 0, "no API key is resolved for a refused call");
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].status, "blocked");
    assert.equal(auditEvents[0].policyDecision, "blocked");
    assert.equal(auditEvents[0].allowCloud, false);
    assert.equal(auditEvents[0].actorId, "student-1");
    assert.equal(auditEvents[0].route, "ai.resolve");
  });

  it("lets a coaching-lane task reach the cloud provider", async () => {
    const provider = await resolveAiProvider({ studentId: "student-1", task: "sage_student_chat", sensitivity: "student_record" });
    assert.equal(provider.name, "gemini");
    assert.deepEqual(auditEvents, []);
  });

  it("never consults the policy when the local provider serves the call", async () => {
    mockGetPlain.mock.mockImplementation(configStore({ ...LOCAL, ai_cloud_policy: "lanes" }));
    const provider = await resolveAiProvider({ studentId: "student-1", task: "chat_file_gist", sensitivity: "student_record" });
    assert.equal(provider.name, "ollama");
    assert.deepEqual(auditEvents, []);
  });
});

describe("local_only", () => {
  beforeEach(() => {
    mockGetPlain.mock.mockImplementation(configStore({ ai_provider: "cloud", ai_cloud_policy: "local_only" }));
  });

  it("refuses every local-only sensitivity on the cloud provider", async () => {
    for (const [task, sensitivity] of [
      ["sage_student_chat", "student_record"],
      ["sage_staff_chat", "staff_entered"],
      ["sage_post_response", "student_record"],
    ] as [AiTask, DataSensitivity][]) {
      await assert.rejects(
        resolveAiProvider({ studentId: "student-1", task, sensitivity }),
        AiCloudRefusedError,
        `${task}/${sensitivity}`,
      );
    }
    assert.equal(auditEvents.length, 3);
    assert.ok(auditEvents.every((event) => event.status === "blocked"));
  });

  it("still lets public and system prompts reach the cloud provider", async () => {
    const pub = await resolveAiProvider({ studentId: "student-1", task: "public_program_help", sensitivity: "public_program" });
    assert.equal(pub.name, "gemini");
    const sys = await resolveAiProvider({ studentId: "student-1", task: "legacy", sensitivity: "system" });
    assert.equal(sys.name, "gemini");
    assert.deepEqual(auditEvents, []);
  });

  it("reads the policy from the AI_CLOUD_POLICY env var when SystemConfig is unset", async () => {
    mockGetPlain.mock.mockImplementation(configStore({ ai_provider: "cloud" }));
    process.env.AI_CLOUD_POLICY = "local_only";
    await assert.rejects(
      resolveAiProvider({ studentId: "student-1", task: "sage_student_chat", sensitivity: "student_record" }),
      AiCloudRefusedError,
    );
  });
});

describe("personal Gemini keys (AC3)", () => {
  it("never allows a personal key for a student_record or staff_entered call", async () => {
    mockGetPlain.mock.mockImplementation(configStore({ ai_provider: "cloud" }));
    await resolveAiProvider({ studentId: "student-1", task: "sage_student_chat", sensitivity: "student_record" });
    await resolveAiProvider({ studentId: "student-1", task: "sage_staff_chat", sensitivity: "staff_entered" });
    assert.equal(mockResolveKey.mock.callCount(), 2);
    for (const call of mockResolveKey.mock.calls) {
      assert.equal(call.arguments[0], "student-1");
      assert.deepEqual(call.arguments[1], { allowPersonalKey: false });
    }
  });

  it("keeps the personal key for the public-program path", async () => {
    mockGetPlain.mock.mockImplementation(configStore({ ai_provider: "cloud" }));
    await resolveAiProvider({ studentId: "student-1", task: "public_program_help", sensitivity: "public_program" });
    assert.deepEqual(mockResolveKey.mock.calls[0].arguments[1], { allowPersonalKey: true });
  });

  it("refuses a personal key for EVERY sensitivity other than public_program (audit W3)", async () => {
    // The predicate used to be `!isLocalOnlySensitivity(...)`, which admitted
    // `configured` and `system`. No production call site declares either
    // today, so the hole was latent — and the next one to declare it would
    // have got a personal consumer key on student content with nothing
    // failing. An allowlist refuses a sensitivity added later by default.
    mockGetPlain.mock.mockImplementation(configStore({ ai_provider: "cloud" }));
    for (const sensitivity of ["configured", "system", "student_record", "staff_entered"] as DataSensitivity[]) {
      mockResolveKey.mock.resetCalls();
      await resolveAiProvider({ studentId: "student-1", task: "legacy", sensitivity });
      assert.deepEqual(
        mockResolveKey.mock.calls[0].arguments[1],
        { allowPersonalKey: false },
        sensitivity,
      );
    }
  });

  it("no longer exports a resolver that takes no sensitivity (audit W3)", async () => {
    // `getProvider` bypassed the cloud policy AND the de-identification layer
    // because it declared none. Both controls key off `sensitivity`, so a
    // resolver without one cannot honour either; the barrel must not offer it.
    const barrel = await import("./index");
    assert.equal("getProvider" in barrel, false);
    const providerModule = await import("./provider");
    assert.equal("getProvider" in providerModule, false);
  });
});
