import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";

type ProviderStub = {
  name: string;
  generateStructuredResponse: (...args: unknown[]) => Promise<string>;
};

const mockResolveAiProvider = mock.fn<(request: unknown) => Promise<ProviderStub>>();
const mockLogLlmCall = mock.fn<(params: unknown) => Promise<void>>();

mock.module("@/lib/ai", {
  namedExports: {
    resolveAiProvider: mockResolveAiProvider,
  },
});

mock.module("@/lib/llm-usage", {
  namedExports: {
    logLlmCall: mockLogLlmCall,
  },
});

let ATTACHMENT_KINDS: typeof import("./classify-attachment").ATTACHMENT_KINDS;
let classifyFromText: typeof import("./classify-attachment").classifyFromText;
let normalizeClassification: typeof import("./classify-attachment").normalizeClassification;
let classifyAttachment: typeof import("./classify-attachment").classifyAttachment;

before(async () => {
  const mod = await import("./classify-attachment");
  ATTACHMENT_KINDS = mod.ATTACHMENT_KINDS;
  classifyFromText = mod.classifyFromText;
  normalizeClassification = mod.normalizeClassification;
  classifyAttachment = mod.classifyAttachment;
});

describe("normalizeClassification — model JSON hardening", () => {
  it("accepts a well-formed object and trims nullable strings", () => {
    const result = normalizeClassification({
      kind: "certificate",
      title: "  IC3 Digital Literacy  ",
      issuer: "Certiport",
      dateOn: "March 3, 2026",
      isCompleted: true,
      identifiers: ["IC3-1234", "  ", "MOS-9"],
      summary: "An IC3 certificate awarded to the student.",
      confidence: "high",
    });

    assert.ok(result);
    assert.equal(result.kind, "certificate");
    assert.equal(result.title, "IC3 Digital Literacy");
    assert.equal(result.issuer, "Certiport");
    assert.equal(result.dateOn, "March 3, 2026");
    assert.equal(result.isCompleted, true);
    // Blank/whitespace identifiers are dropped, real ones trimmed.
    assert.deepEqual(result.identifiers, ["IC3-1234", "MOS-9"]);
    assert.equal(result.confidence, "high");
  });

  it("rejects objects with an invalid/missing kind", () => {
    assert.equal(normalizeClassification({ kind: "spaceship", summary: "x" }), null);
    assert.equal(normalizeClassification({ summary: "x" }), null);
    assert.equal(normalizeClassification(null), null);
    assert.equal(normalizeClassification("not an object"), null);
  });

  it("coerces missing optional fields to safe defaults", () => {
    const result = normalizeClassification({ kind: "form" });
    assert.ok(result);
    assert.equal(result.title, null);
    assert.equal(result.issuer, null);
    assert.equal(result.dateOn, null);
    assert.equal(result.isCompleted, null);
    assert.deepEqual(result.identifiers, []);
    assert.equal(result.confidence, "low"); // invalid/missing confidence floors to low
    assert.ok(result.summary.length > 0);
  });

  it("only keeps boolean isCompleted (string 'true' is not a boolean)", () => {
    const result = normalizeClassification({ kind: "certificate", isCompleted: "true", summary: "s" });
    assert.ok(result);
    assert.equal(result.isCompleted, null);
  });

  it("every declared kind round-trips", () => {
    for (const kind of ATTACHMENT_KINDS) {
      const result = normalizeClassification({ kind, summary: "s", confidence: "medium" });
      assert.ok(result, `kind ${kind} should normalize`);
      assert.equal(result.kind, kind);
    }
  });
});

describe("classifyFromText — local heuristic fallback", () => {
  it("detects a certificate and a completed signal", () => {
    const result = classifyFromText(
      "Certificate of Completion. This is hereby awarded to Jane Doe, who has completed the course on 03/14/2026.",
    );
    assert.equal(result.kind, "certificate");
    assert.equal(result.isCompleted, true);
    assert.equal(result.dateOn, "03/14/2026");
    assert.equal(result.confidence, "low");
  });

  it("detects a resume", () => {
    const result = classifyFromText(
      "Professional Summary: dependable worker. Work Experience: cashier. References available upon request.",
    );
    assert.equal(result.kind, "resume");
  });

  it("falls back to 'other' for unrecognizable text", () => {
    const result = classifyFromText("lorem ipsum dolor sit amet nothing matches here");
    assert.equal(result.kind, "other");
    assert.equal(result.isCompleted, null);
    assert.equal(result.dateOn, null);
  });

  it("never returns an empty summary", () => {
    const result = classifyFromText("a");
    assert.ok(result.summary.length > 0);
  });
});

describe("classifyAttachment — precedence: cloud -> local structured -> keywords -> none", () => {
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockResolveAiProvider.mock.resetCalls();
    mockLogLlmCall.mock.resetCalls();
    mockLogLlmCall.mock.mockImplementation(async () => undefined);
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (originalGeminiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiKey;
    }
    global.fetch = originalFetch;
  });

  function txtBuffer(text: string): Buffer {
    return Buffer.from(text, "utf-8");
  }

  it("valid local JSON produces a 'local_structured' result and never touches keyword heuristics", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => ({
      name: "ollama",
      generateStructuredResponse: async () =>
        JSON.stringify({
          kind: "certificate",
          title: "IC3 Digital Literacy",
          issuer: "Certiport",
          dateOn: "03/14/2026",
          isCompleted: true,
          identifiers: ["IC3-1234"],
          summary: "An IC3 certificate.",
          confidence: "high",
        }),
    }));

    const result = await classifyAttachment({
      buffer: txtBuffer("lorem ipsum dolor sit amet nothing matches keywords here"),
      filename: "cert.txt",
      mimeType: "text/plain",
      studentId: "student-1",
      cloudAllowed: false,
    });

    assert.equal(result.method, "local_structured");
    assert.equal(result.classification.kind, "certificate");
    assert.equal(result.classification.title, "IC3 Digital Literacy");
    assert.equal(result.classification.issuer, "Certiport");
    assert.deepEqual(result.classification.identifiers, ["IC3-1234"]);
    assert.equal(result.classification.confidence, "high");

    assert.equal(mockResolveAiProvider.mock.callCount(), 1);
    const request = mockResolveAiProvider.mock.calls[0].arguments[0] as {
      studentId: string;
      task: string;
      sensitivity: string;
    };
    assert.equal(request.studentId, "student-1");
    assert.equal(request.task, "chat_file_gist");
    assert.equal(request.sensitivity, "student_record");
  });

  it("malformed local JSON falls through to keyword heuristics", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => ({
      name: "ollama",
      generateStructuredResponse: async () => "not valid json{{{",
    }));

    const result = await classifyAttachment({
      buffer: txtBuffer("Certificate of Completion. This is hereby awarded to Jane Doe."),
      filename: "cert.txt",
      mimeType: "text/plain",
      studentId: "student-2",
      cloudAllowed: false,
    });

    assert.equal(result.method, "local");
    assert.equal(result.classification.kind, "certificate");
  });

  it("local JSON that fails schema validation (missing required fields) falls through to keyword heuristics", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => ({
      name: "ollama",
      // Missing required "summary" and "confidence" fields.
      generateStructuredResponse: async () => JSON.stringify({ kind: "certificate" }),
    }));

    const result = await classifyAttachment({
      buffer: txtBuffer("Certificate of Completion. This is hereby awarded to Jane Doe."),
      filename: "cert.txt",
      mimeType: "text/plain",
      studentId: "student-3",
      cloudAllowed: false,
    });

    assert.equal(result.method, "local");
  });

  it("does not attempt local classification when the resolved provider is not local (ollama)", async () => {
    const generateStructuredResponse = mock.fn(async () => JSON.stringify({ kind: "form", summary: "x", confidence: "low" }));
    mockResolveAiProvider.mock.mockImplementation(async () => ({
      name: "gemini",
      generateStructuredResponse,
    }));

    const result = await classifyAttachment({
      buffer: txtBuffer("Professional Summary: dependable worker. Work Experience: cashier."),
      filename: "resume.txt",
      mimeType: "text/plain",
      studentId: "student-4",
      cloudAllowed: false,
    });

    assert.equal(generateStructuredResponse.mock.callCount(), 0);
    assert.equal(result.method, "local");
    assert.equal(result.classification.kind, "resume");
  });

  it("falls through to keyword heuristics when provider resolution throws", async () => {
    mockResolveAiProvider.mock.mockImplementation(async () => {
      throw new Error("Local AI server URL is not configured.");
    });

    const result = await classifyAttachment({
      buffer: txtBuffer("Professional Summary: dependable worker. Work Experience: cashier."),
      filename: "resume.txt",
      mimeType: "text/plain",
      studentId: "student-5",
      cloudAllowed: false,
    });

    assert.equal(result.method, "local");
    assert.equal(result.classification.kind, "resume");
  });

  it("cloud consent path is unchanged: with consent + a working cloud call, method is 'cloud' and local/keywords are skipped", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      kind: "transcript",
                      title: "Fall Semester Transcript",
                      issuer: null,
                      dateOn: null,
                      isCompleted: null,
                      identifiers: [],
                      summary: "A transcript.",
                      confidence: "high",
                    }),
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const result = await classifyAttachment({
      buffer: txtBuffer("irrelevant text — cloud path should win before extraction even matters"),
      filename: "transcript.txt",
      mimeType: "text/plain",
      studentId: "student-6",
      cloudAllowed: true,
    });

    assert.equal(result.method, "cloud");
    assert.equal(result.classification.kind, "transcript");
    // Cloud success short-circuits before local resolution is ever attempted.
    assert.equal(mockResolveAiProvider.mock.callCount(), 0);
  });

  it("cloud consent path is unchanged: cloud failure (no API key) still falls through to local/keywords", async () => {
    // GEMINI_API_KEY intentionally left unset (cloudClassify returns null immediately).
    mockResolveAiProvider.mock.mockImplementation(async () => ({
      name: "ollama",
      generateStructuredResponse: async () =>
        JSON.stringify({ kind: "letter", summary: "A letter.", confidence: "medium" }),
    }));

    const result = await classifyAttachment({
      buffer: txtBuffer("Dear Sir or Madam, sincerely, the applicant"),
      filename: "letter.txt",
      mimeType: "text/plain",
      studentId: "student-7",
      cloudAllowed: true,
    });

    assert.equal(result.method, "local_structured");
    assert.equal(result.classification.kind, "letter");
  });

  it("returns method 'none' when no text can be extracted (e.g. unsupported/image file) and cloud is off", async () => {
    const result = await classifyAttachment({
      buffer: txtBuffer("irrelevant — .png is unsupported by extractTextFromBuffer"),
      filename: "photo.png",
      mimeType: "image/png",
      studentId: "student-8",
      cloudAllowed: false,
    });

    assert.equal(result.method, "none");
    assert.equal(mockResolveAiProvider.mock.callCount(), 0);
  });
});
