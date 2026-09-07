import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * `resolveEmbeddingProvider` under the cloud policy (FERPA review Sprint 1,
 * item 10). Before this change the embedding path had no sensitivity, no
 * policy and no audit event: the raw chat message and every stored memory
 * went to Gemini's embeddings API invisibly. Now every resolution declares a
 * sensitivity, honours `ai_cloud_policy` for the `embedding` task, and writes
 * a `routed` or `blocked` AI audit event.
 */

const mockGetPlainConfigValue = mock.fn<(key: string) => Promise<string | null>>();
const mockGetConfigValue = mock.fn<(key: string) => Promise<string | null>>();
const mockResolveApiKey = mock.fn<(studentId: string, opts?: unknown) => Promise<string>>();

mock.module("@/lib/system-config", {
  namedExports: { getPlainConfigValue: mockGetPlainConfigValue, getConfigValue: mockGetConfigValue },
});
mock.module("@/lib/chat/api-key", {
  namedExports: { resolveApiKey: mockResolveApiKey },
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

let resolveEmbeddingProvider: typeof import("./embedding-provider").resolveEmbeddingProvider;
let AiCloudRefusedError: typeof import("./lanes").AiCloudRefusedError;

before(async () => {
  ({ resolveEmbeddingProvider } = await import("./embedding-provider"));
  ({ AiCloudRefusedError } = await import("./lanes"));
});

function configStore(values: Record<string, string>) {
  return async (key: string) => values[key] ?? null;
}

const LOCAL = { ai_provider: "local", ai_provider_url: "http://localhost:11434" };

beforeEach(() => {
  mockGetPlainConfigValue.mock.resetCalls();
  mockGetConfigValue.mock.resetCalls();
  mockResolveApiKey.mock.resetCalls();
  mockGetConfigValue.mock.mockImplementation(async () => null);
  mockResolveApiKey.mock.mockImplementation(async () => "platform-key");
  delete process.env.AI_CLOUD_POLICY;
  auditEvents.length = 0;
});

// Compile-time pin: the options object and its sensitivity are required.
// tsc checks this file; a resolver that accepted a call with no sensitivity
// would make the `@ts-expect-error` below an "unused directive" error.
void (async () => {
  // @ts-expect-error sensitivity is required — an embedding call must declare what it carries
  await resolveEmbeddingProvider({ studentId: "student-1" });
  // @ts-expect-error the options object itself is required
  await resolveEmbeddingProvider();
});

describe("resolveEmbeddingProvider — permissive (default)", () => {
  it("returns Gemini for a student_record embedding and writes a routed event for task 'embedding'", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(configStore({}));

    const provider = await resolveEmbeddingProvider({
      studentId: "student-1",
      sensitivity: "student_record",
      callSite: "sage_memory_extract",
    });

    assert.equal(provider.name, "gemini");
    assert.equal(auditEvents.length, 1);
    const event = auditEvents[0];
    assert.equal(event.task, "embedding");
    assert.equal(event.status, "routed");
    assert.equal(event.sensitivity, "student_record");
    assert.equal(event.actorId, "student-1");
    assert.equal(event.targetId, "student-1");
    assert.equal(event.route, "ai.resolve");
    assert.equal(event.providerName, "gemini");
    assert.equal(event.providerClass, "cloud");
    assert.equal(event.policyDecision, "configured_provider");
    assert.equal(event.allowCloud, true);
    assert.deepEqual(event.metadata, { callSite: "sage_memory_extract", lane: "coaching", policy: "permissive" });
  });

  it("allows the personal key ONLY for public_program: student_record, system and configured all refuse it", async () => {
    // Allowlist, not a negation (2026-09-07 review, W3's twin on the
    // embeddings path): `system` with a studentId used to get a personal key.
    mockGetPlainConfigValue.mock.mockImplementation(configStore({}));

    await resolveEmbeddingProvider({ studentId: "student-1", sensitivity: "student_record" });
    await resolveEmbeddingProvider({ studentId: "student-1", sensitivity: "system", callSite: "sage_embedding_backfill" });
    await resolveEmbeddingProvider({ studentId: "student-1", sensitivity: "configured" });
    await resolveEmbeddingProvider({ studentId: "student-1", sensitivity: "public_program" });

    assert.equal(mockResolveApiKey.mock.callCount(), 4);
    assert.deepEqual(mockResolveApiKey.mock.calls[0].arguments[1], { allowPersonalKey: false });
    assert.deepEqual(mockResolveApiKey.mock.calls[1].arguments[1], { allowPersonalKey: false });
    assert.deepEqual(mockResolveApiKey.mock.calls[2].arguments[1], { allowPersonalKey: false });
    assert.deepEqual(mockResolveApiKey.mock.calls[3].arguments[1], { allowPersonalKey: true });
  });

  it("returns Ollama under ai_provider=local and records the local decision", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(configStore(LOCAL));

    const provider = await resolveEmbeddingProvider({ studentId: "student-1", sensitivity: "student_record" });

    assert.equal(provider.name, "ollama");
    assert.equal(mockResolveApiKey.mock.callCount(), 0);
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].status, "routed");
    assert.equal(auditEvents[0].providerName, "ollama");
    assert.equal(auditEvents[0].providerClass, "local");
    assert.equal(auditEvents[0].policyDecision, "local_only");
    assert.equal(auditEvents[0].allowCloud, false);
  });
});

describe("resolveEmbeddingProvider — local_only", () => {
  beforeEach(() => {
    mockGetPlainConfigValue.mock.mockImplementation(configStore({ ai_provider: "cloud", ai_cloud_policy: "local_only" }));
  });

  it("refuses a student_record embedding on the cloud provider, after a blocked event", async () => {
    await assert.rejects(
      resolveEmbeddingProvider({ studentId: "student-1", sensitivity: "student_record", callSite: "sage_embedding_query" }),
      (error: unknown) => error instanceof AiCloudRefusedError && error.task === "embedding" && error.policy === "local_only",
    );
    assert.equal(mockResolveApiKey.mock.callCount(), 0, "no key resolved for a refused call");
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].task, "embedding");
    assert.equal(auditEvents[0].status, "blocked");
    assert.equal(auditEvents[0].policyDecision, "blocked");
    assert.equal(auditEvents[0].allowCloud, false);
    assert.equal(auditEvents[0].actorId, "student-1");
  });

  it("still serves a system embedding (document ingest) from the cloud", async () => {
    const provider = await resolveEmbeddingProvider({ studentId: null, sensitivity: "system" });
    assert.equal(provider.name, "gemini");
    assert.equal(auditEvents[0].status, "routed");
    assert.equal(auditEvents[0].actorId, null);
  });

  it("never consults the policy when the local provider serves the call", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(configStore({ ...LOCAL, ai_cloud_policy: "local_only" }));
    const provider = await resolveEmbeddingProvider({ studentId: "student-1", sensitivity: "student_record" });
    assert.equal(provider.name, "ollama");
    assert.equal(auditEvents[0].status, "routed");
  });
});

describe("resolveEmbeddingProvider — lanes", () => {
  it("lets a student_record embedding through (coaching lane), so only local_only refuses it today", async () => {
    mockGetPlainConfigValue.mock.mockImplementation(configStore({ ai_provider: "cloud", ai_cloud_policy: "lanes" }));
    const provider = await resolveEmbeddingProvider({ studentId: "student-1", sensitivity: "student_record" });
    assert.equal(provider.name, "gemini");
    assert.equal(auditEvents[0].status, "routed");
    assert.equal((auditEvents[0].metadata as Record<string, unknown>).policy, "lanes");
  });
});
