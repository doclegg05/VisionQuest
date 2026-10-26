import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import type { AIProvider, ChatMessage } from "./types";

/**
 * AC2: `resolveAiProvider` wraps a CLOUD provider in the de-identification
 * decorator for the two local-only sensitivities, so no call site can forget,
 * and the wrapping is measurable from outside — the fake Gemini below records
 * exactly what left the process.
 *
 * Ordering is the load-bearing part: the Wave 1 policy refusal runs FIRST. A
 * refused call must never be de-identified and sent anyway, so `loadIdentityInput`
 * is spied on and asserted never called on the refusal path.
 */

const mockGetPlain = mock.fn<(key: string) => Promise<string | null>>();
const mockResolveKey = mock.fn<(studentId: string, opts?: unknown) => Promise<string>>();
const loadIdentityInput = mock.fn<(args: unknown) => Promise<Record<string, unknown>>>();

/** Everything the fake Gemini was handed, so the test can read the wire. */
interface Sent {
  systemPrompt: string;
  messages: ChatMessage[];
}
const sent: Sent[] = [];

class FakeGemini implements AIProvider {
  readonly name = "gemini";
  readonly model = "gemini-3.1-flash-lite";
  async generateResponse(systemPrompt: string, messages: ChatMessage[]): Promise<string> {
    sent.push({ systemPrompt, messages });
    return "Hi [STUDENT_FIRST_NAME], your email is [STUDENT_EMAIL].";
  }
  async *streamResponse(): AsyncGenerator<string> {
    yield "";
  }
  async generateStructuredResponse(): Promise<string> {
    return "{}";
  }
  async describeDocument(): Promise<string> {
    return "a document about [STUDENT_NAME]";
  }
}

class FakeOllama implements AIProvider {
  readonly name = "ollama";
  readonly model = "gemma4";
  async generateResponse(systemPrompt: string, messages: ChatMessage[]): Promise<string> {
    sent.push({ systemPrompt, messages });
    return "local reply";
  }
  async *streamResponse(): AsyncGenerator<string> {
    yield "";
  }
  async generateStructuredResponse(): Promise<string> {
    return "{}";
  }
}

mock.module("@/lib/system-config", {
  namedExports: { getPlainConfigValue: mockGetPlain, getConfigValue: async () => null },
});
mock.module("@/lib/chat/api-key", { namedExports: { resolveApiKey: mockResolveKey } });
mock.module("./gemini-provider", { namedExports: { GeminiProvider: FakeGemini } });
mock.module("./ollama-provider", {
  namedExports: {
    OllamaProvider: Object.assign(FakeOllama, { SECONDARY_KEEP_ALIVE: "30s" }),
  },
});
mock.module("@/lib/ai/identity", {
  namedExports: {
    loadIdentityInput,
    MANAGED_ROSTER_CAP: 500,
    listManagedRosterNames: async () => [],
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
const SYSTEM = "You are coaching Jordan Lee (jordan.lee@example.org). Say hi to Jordan.";
const MESSAGES: ChatMessage[] = [{ role: "user", content: "hi, I'm Jordan and my number is 304-555-0134" }];

beforeEach(() => {
  sent.length = 0;
  auditEvents.length = 0;
  mockGetPlain.mock.resetCalls();
  mockResolveKey.mock.resetCalls();
  loadIdentityInput.mock.resetCalls();
  mockResolveKey.mock.mockImplementation(async () => "platform-key");
  loadIdentityInput.mock.mockImplementation(async () => ({
    studentName: "Jordan Lee",
    studentEmail: "jordan.lee@example.org",
    studentLoginId: "jlee2026",
  }));
  mockGetPlain.mock.mockImplementation(configStore({ ai_provider: "cloud" }));
  delete process.env.AI_CLOUD_POLICY;
  delete process.env.AI_DEIDENTIFY_CLOUD;
});

describe("cloud + local-only sensitivity → the provider is wrapped", () => {
  it("hands the model a pseudonymised system prompt and messages, and re-hydrates the reply", async () => {
    const provider = await resolveAiProvider({
      studentId: "stu1",
      task: "sage_student_chat",
      sensitivity: "student_record",
    });
    const reply = await provider.generateResponse(SYSTEM, MESSAGES);

    assert.equal(sent.length, 1);
    assert.equal(
      sent[0].systemPrompt,
      "You are coaching [STUDENT_NAME] ([STUDENT_EMAIL]). Say hi to [STUDENT_FIRST_NAME].",
    );
    assert.equal(
      sent[0].messages[0].content,
      "hi, I'm [STUDENT_FIRST_NAME] and my number is [PHONE_1]",
    );
    for (const text of [sent[0].systemPrompt, sent[0].messages[0].content]) {
      assert.ok(!text.includes("Jordan"), text);
      assert.ok(!text.includes("example.org"), text);
      assert.ok(!text.includes("0134"), text);
    }
    assert.equal(reply, "Hi Jordan, your email is jordan.lee@example.org.");
  });

  it("keeps the provider name and the model tag, so routing checks and LlmCallLog still work", async () => {
    const provider = await resolveAiProvider({
      studentId: "stu1",
      task: "sage_student_chat",
      sensitivity: "student_record",
    });
    assert.equal(provider.name, "gemini");
    assert.equal((provider as { model?: string }).model, "gemini-3.1-flash-lite");
  });

  it("keeps describeDocument reachable and pseudonymises its prompt", async () => {
    const provider = await resolveAiProvider({
      studentId: "stu1",
      task: "chat_file_gist",
      sensitivity: "student_record",
    });
    assert.equal(typeof provider.describeDocument, "function");
    const out = await provider.describeDocument!(Buffer.from("pdf"), "application/pdf", "Summarise for Jordan Lee");
    assert.equal(out, "a document about Jordan Lee");
  });

  it("merges the call site's own identity material with the loader's", async () => {
    const provider = await resolveAiProvider({
      studentId: "teach1",
      task: "sage_staff_chat",
      sensitivity: "staff_entered",
      identity: { rosterNames: ["Sam Okafor"] },
    });
    await provider.generateResponse("Sam Okafor is in Jordan Lee's class", []);
    assert.equal(sent[0].systemPrompt, "[PERSON_1] is in [STUDENT_NAME]'s class");
  });

  it("wraps whenever the loader found a name (the addendum's no-empty-vault rule)", async () => {
    loadIdentityInput.mock.mockImplementation(async () => ({ studentName: "Jordan Lee" }));
    const provider = await resolveAiProvider({
      studentId: "stu1",
      task: "sage_student_chat",
      sensitivity: "student_record",
    });
    assert.notEqual(provider.generateResponse, FakeGemini.prototype.generateResponse);
    await provider.generateResponse(SYSTEM, []);
    assert.ok(!sent[0].systemPrompt.includes("Jordan Lee"));
  });

  it("leaves an allowlisted crisis number verbatim", async () => {
    const provider = await resolveAiProvider({
      studentId: "stu1",
      task: "sage_student_chat",
      sensitivity: "student_record",
    });
    await provider.generateResponse("If Jordan Lee is in crisis, call 988 or 1-800-273-8255.", []);
    assert.equal(sent[0].systemPrompt, "If [STUDENT_NAME] is in crisis, call 988 or 1-800-273-8255.");
  });

  it("writes a routed audit event naming the tokens — names, never values", async () => {
    await resolveAiProvider({ studentId: "stu1", task: "sage_student_chat", sensitivity: "student_record" });
    assert.equal(auditEvents.length, 1);
    const event = auditEvents[0];
    assert.equal(event.status, "routed");
    assert.equal(event.route, "ai.resolve");
    assert.equal(event.providerClass, "cloud");
    const metadata = event.metadata as { deidentified: boolean; tokens: string[] };
    assert.equal(metadata.deidentified, true);
    assert.deepEqual(metadata.tokens, [
      "[STUDENT_EMAIL]",
      "[STUDENT_FIRST_NAME]",
      "[STUDENT_LOGIN]",
      "[STUDENT_NAME]",
    ]);
    const serialized = JSON.stringify(event);
    assert.ok(!serialized.includes("Jordan"), "no vault VALUE may reach the audit log");
    assert.ok(!serialized.includes("jlee2026"));
  });
});

describe("cases that must NOT be wrapped", () => {
  async function assertRaw(request: Parameters<typeof resolveAiProvider>[0]) {
    const provider = await resolveAiProvider(request);
    await provider.generateResponse(SYSTEM, MESSAGES);
    assert.equal(sent[0].systemPrompt, SYSTEM, "the raw prompt reached the provider unchanged");
    assert.equal(sent[0].messages[0].content, MESSAGES[0].content);
  }

  it("public_program on the cloud provider", async () => {
    await assertRaw({ studentId: "stu1", task: "public_program_help", sensitivity: "public_program" });
    assert.equal(loadIdentityInput.mock.callCount(), 0, "no identity is loaded for a public call");
  });

  it("the local provider is never wrapped", async () => {
    mockGetPlain.mock.mockImplementation(configStore(LOCAL));
    await assertRaw({ studentId: "stu1", task: "sage_student_chat", sensitivity: "student_record" });
    assert.equal(loadIdentityInput.mock.callCount(), 0);
  });

  it("the kill switch off (SystemConfig)", async () => {
    mockGetPlain.mock.mockImplementation(configStore({ ai_provider: "cloud", ai_deidentify_cloud: "off" }));
    await assertRaw({ studentId: "stu1", task: "sage_student_chat", sensitivity: "student_record" });
    assert.equal(loadIdentityInput.mock.callCount(), 0);
    assert.deepEqual(auditEvents, []);
  });

  it("the kill switch off (env)", async () => {
    process.env.AI_DEIDENTIFY_CLOUD = "off";
    await assertRaw({ studentId: "stu1", task: "sage_student_chat", sensitivity: "student_record" });
    assert.equal(loadIdentityInput.mock.callCount(), 0);
  });

  it("anything other than \"off\" leaves it ON — the switch fails safe", async () => {
    for (const value of ["on", "ON", "true", "yes", "", "  ", "banana"]) {
      sent.length = 0;
      mockGetPlain.mock.mockImplementation(configStore({ ai_provider: "cloud", ai_deidentify_cloud: value }));
      const provider = await resolveAiProvider({
        studentId: "stu1",
        task: "sage_student_chat",
        sensitivity: "student_record",
      });
      await provider.generateResponse(SYSTEM, []);
      assert.ok(!sent[0].systemPrompt.includes("Jordan Lee"), `ai_deidentify_cloud=${JSON.stringify(value)}`);
    }
  });

  it("an empty vault returns the provider unwrapped rather than an inert decorator", async () => {
    loadIdentityInput.mock.mockImplementation(async () => ({}));
    await assertRaw({ studentId: "stu1", task: "sage_student_chat", sensitivity: "student_record" });
    assert.equal(loadIdentityInput.mock.callCount(), 1);
    assert.deepEqual(auditEvents, [], "an unwrapped call writes no deidentified event");
  });

  it("a loader failure degrades to today's behaviour instead of failing the turn", async () => {
    loadIdentityInput.mock.mockImplementation(async () => {
      throw new Error("db down");
    });
    await assertRaw({ studentId: "stu1", task: "sage_student_chat", sensitivity: "student_record" });
  });
});

describe("ordering: the policy refusal comes first", () => {
  it("throws before any vault is built", async () => {
    mockGetPlain.mock.mockImplementation(
      configStore({ ai_provider: "cloud", ai_cloud_policy: "local_only" }),
    );
    await assert.rejects(
      resolveAiProvider({ studentId: "stu1", task: "sage_student_chat", sensitivity: "student_record" }),
      AiCloudRefusedError,
    );
    assert.equal(loadIdentityInput.mock.callCount(), 0, "a refused call is never de-identified and sent");
    assert.equal(mockResolveKey.mock.callCount(), 0);
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].status, "blocked");
  });
});
