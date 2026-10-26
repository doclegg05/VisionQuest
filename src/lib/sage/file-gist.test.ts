/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";

/**
 * The cloud gist path goes through `resolveAiProvider` (FERPA review Sprint
 * 1, item 8). Before this change `cloudGist` posted the document bytes to
 * generativelanguage.googleapis.com by raw `fetch` with
 * `process.env.GEMINI_API_KEY`, so `ai_provider = "local"` and every routing
 * rule were bypassed for uploaded documents. Now the resolved provider must
 * offer `describeDocument`; anything else declines the cloud path and the
 * decision is audited.
 */

const mockResolveAiProvider = mock.fn() as any;
mock.module("@/lib/ai/provider", {
  namedExports: { resolveAiProvider: mockResolveAiProvider },
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

const mockLogLlmCall = mock.fn(async () => undefined) as any;
mock.module("@/lib/llm-usage", {
  namedExports: { logLlmCall: mockLogLlmCall },
});

// Force the deterministic fallback to find nothing, so the method the caller
// sees is decided by the cloud path alone.
mock.module("./extract", {
  namedExports: { extractTextFromBuffer: async () => null },
});

let buildFileGist: typeof import("./file-gist").buildFileGist;
let AiCloudRefusedError: typeof import("@/lib/ai/lanes").AiCloudRefusedError;

before(async () => {
  ({ buildFileGist } = await import("./file-gist"));
  ({ AiCloudRefusedError } = await import("@/lib/ai/lanes"));
});

const originalFetch = global.fetch;
const originalKey = process.env.GEMINI_API_KEY;
let fetchCalls = 0;

beforeEach(() => {
  mockResolveAiProvider.mock.resetCalls();
  mockLogLlmCall.mock.resetCalls();
  auditEvents.length = 0;
  fetchCalls = 0;
  // The raw-fetch bypass is gone: an env key plus a live fetch must never be
  // enough to send document bytes anywhere.
  process.env.GEMINI_API_KEY = "env-key-that-must-not-be-used";
  global.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("file-gist must not call fetch directly");
  }) as unknown as typeof fetch;
});

after(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
});

const params = {
  buffer: Buffer.from("%PDF-1.4 pretend bytes"),
  filename: "form.pdf",
  mimeType: "application/pdf",
  studentId: "student-1",
};

describe("buildFileGist — cloud path through the resolver", () => {
  it("uses the resolved provider's describeDocument and audits the routing", async () => {
    const describeDocument = mock.fn(async () => "A signed DoHS attendance contract.");
    mockResolveAiProvider.mock.mockImplementation(async () => ({
      name: "gemini",
      model: "gemini-test",
      describeDocument,
    }));

    const result = await buildFileGist({ ...params, cloudAllowed: true });

    assert.equal(result.method, "cloud");
    assert.equal(result.gist, "A signed DoHS attendance contract.");
    assert.equal(fetchCalls, 0);

    assert.equal(mockResolveAiProvider.mock.callCount(), 1);
    assert.deepEqual(mockResolveAiProvider.mock.calls[0].arguments[0], {
      studentId: "student-1",
      task: "chat_file_gist",
      sensitivity: "student_record",
    });

    const [buffer, mimeType, prompt] = describeDocument.mock.calls[0].arguments as unknown as [Buffer, string, string];
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(mimeType, "application/pdf");
    assert.match(prompt, /Describe this document/);

    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].status, "routed");
    assert.equal(auditEvents[0].task, "chat_file_gist");
    assert.equal(auditEvents[0].sensitivity, "student_record");
    assert.equal(auditEvents[0].actorId, "student-1");
    assert.equal(auditEvents[0].providerName, "gemini");
    assert.equal(auditEvents[0].allowCloud, true);

    assert.equal(mockLogLlmCall.mock.callCount(), 1);
    assert.equal(mockLogLlmCall.mock.calls[0].arguments[0].studentId, "student-1");
    assert.equal(mockLogLlmCall.mock.calls[0].arguments[0].callSite, "chat_file_gist");
  });

  it("declines the cloud path when the resolved provider cannot read documents (ai_provider=local), with a blocked event", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => ({ name: "ollama" }));

    const result = await buildFileGist({ ...params, cloudAllowed: true });

    assert.equal(result.method, "none");
    assert.equal(fetchCalls, 0);
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].status, "blocked");
    assert.equal(auditEvents[0].allowCloud, false);
    assert.equal(auditEvents[0].providerName, "ollama");
    assert.equal(auditEvents[0].policyDecision, "local_only");
  });

  it("declines quietly when the resolver refuses the cloud (ai_cloud_policy=lanes) — the resolver already audited it", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => {
      throw new AiCloudRefusedError({
        task: "chat_file_gist",
        sensitivity: "student_record",
        lane: "batch",
        policy: "lanes",
        reason: "refused",
      });
    });

    const result = await buildFileGist({ ...params, cloudAllowed: true });

    assert.equal(result.method, "none");
    assert.equal(fetchCalls, 0);
    assert.deepEqual(auditEvents, []);
    assert.equal(mockLogLlmCall.mock.callCount(), 0);
  });

  it("still falls back to local extraction when the provider call itself fails, after a failed event", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => ({
      name: "gemini",
      describeDocument: async () => {
        throw new Error("503 scripted");
      },
    }));

    const result = await buildFileGist({ ...params, cloudAllowed: true });

    assert.equal(result.method, "none");
    assert.deepEqual(
      auditEvents.map((event) => event.status),
      ["routed", "failed"],
    );
  });

  it("never resolves a provider without consent — the consent scope stays an additional gate", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => ({ name: "gemini", describeDocument: async () => "x" }));

    const result = await buildFileGist({ ...params, cloudAllowed: false });

    assert.equal(result.method, "none");
    assert.equal(mockResolveAiProvider.mock.callCount(), 0);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(auditEvents, []);
  });
});
