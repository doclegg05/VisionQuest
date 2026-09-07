/* eslint-disable @typescript-eslint/no-explicit-any -- mock scaffolding must accept many signatures */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/**
 * Audit and routing behaviour of classify-attachment (FERPA review Sprint 1,
 * items 8 and 11). Precedence is pinned in classify-attachment.test.ts; this
 * file pins WHAT gets written to the AI audit log on each path, which was
 * nothing at all before this change.
 */

const mockResolveAiProvider = mock.fn() as any;
mock.module("@/lib/ai", {
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

let classifyAttachment: typeof import("./classify-attachment").classifyAttachment;
let AiCloudRefusedError: typeof import("@/lib/ai/lanes").AiCloudRefusedError;

before(async () => {
  ({ classifyAttachment } = await import("./classify-attachment"));
  ({ AiCloudRefusedError } = await import("@/lib/ai/lanes"));
});

beforeEach(() => {
  mockResolveAiProvider.mock.resetCalls();
  mockLogLlmCall.mock.resetCalls();
  auditEvents.length = 0;
});

const LOCAL_JSON = JSON.stringify({ kind: "letter", summary: "A letter.", confidence: "medium" });

function textParams(text: string, cloudAllowed: boolean) {
  return {
    buffer: Buffer.from(text, "utf-8"),
    filename: "doc.txt",
    mimeType: "text/plain",
    studentId: "student-1",
    cloudAllowed,
  };
}

describe("classifyAttachment — audit trail", () => {
  it("local structured success: routed then completed, actor is the student", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => ({
      name: "ollama",
      generateStructuredResponse: async () => LOCAL_JSON,
    }));

    const result = await classifyAttachment(textParams("Dear Sir, sincerely", false));

    assert.equal(result.method, "local_structured");
    assert.deepEqual(auditEvents.map((event) => event.status), ["routed", "completed"]);
    for (const event of auditEvents) {
      assert.equal(event.task, "chat_file_gist");
      assert.equal(event.sensitivity, "student_record");
      assert.equal(event.actorId, "student-1");
      assert.equal(event.actorRole, "student");
      assert.equal(event.providerName, "ollama");
      assert.equal(event.providerClass, "local");
      assert.equal(event.allowCloud, false);
    }
    assert.equal(auditEvents[1].outputChars, "A letter.".length);
  });

  it("local refusal of a non-local provider writes a blocked event instead of staying silent", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => ({
      name: "gemini",
      generateStructuredResponse: async () => LOCAL_JSON,
    }));

    const result = await classifyAttachment(textParams("Dear Sir, sincerely", false));

    assert.equal(result.method, "local");
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].status, "blocked");
    assert.equal(auditEvents[0].policyDecision, "configured_provider");
    assert.equal(auditEvents[0].providerName, "gemini");
    assert.equal(auditEvents[0].allowCloud, false);
    assert.equal(typeof auditEvents[0].reason, "string");
  });

  it("local structured failure (non-JSON) writes a failed event and falls through", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => ({
      name: "ollama",
      generateStructuredResponse: async () => "not json",
    }));

    const result = await classifyAttachment(textParams("Dear Sir, sincerely", false));

    assert.equal(result.method, "local");
    assert.deepEqual(auditEvents.map((event) => event.status), ["routed", "failed"]);
  });

  it("cloud success through describeDocument: routed then completed, one resolution for the whole call", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => ({
      name: "gemini",
      model: "gemini-test",
      describeDocument: async () => LOCAL_JSON,
    }));

    const result = await classifyAttachment(textParams("anything", true));

    assert.equal(result.method, "cloud");
    assert.equal(mockResolveAiProvider.mock.callCount(), 1);
    assert.deepEqual(auditEvents.map((event) => event.status), ["routed", "completed"]);
    assert.equal(auditEvents[0].allowCloud, true);
    assert.equal(auditEvents[0].providerClass, "cloud");
    assert.equal(mockLogLlmCall.mock.callCount(), 1);
    assert.equal(mockLogLlmCall.mock.calls[0].arguments[0].studentId, "student-1");
  });

  it("with consent but a provider that cannot read documents: blocked for the cloud pass, then the local pass runs on the same provider", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => ({
      name: "ollama",
      generateStructuredResponse: async () => LOCAL_JSON,
    }));

    const result = await classifyAttachment(textParams("Dear Sir, sincerely", true));

    assert.equal(result.method, "local_structured");
    assert.equal(mockResolveAiProvider.mock.callCount(), 1);
    assert.deepEqual(auditEvents.map((event) => event.status), ["blocked", "routed", "completed"]);
  });

  it("a policy refusal from the resolver falls through to keyword heuristics without a second event", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => {
      throw new AiCloudRefusedError({
        task: "chat_file_gist",
        sensitivity: "student_record",
        lane: "batch",
        policy: "lanes",
        reason: "refused",
      });
    });

    const result = await classifyAttachment(textParams("Dear Sir, sincerely", true));

    assert.equal(result.method, "local");
    assert.equal(result.classification.kind, "letter");
    assert.deepEqual(auditEvents, []);
  });
});
