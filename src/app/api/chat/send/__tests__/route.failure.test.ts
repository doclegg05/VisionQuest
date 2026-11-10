import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { mockTeacherSession, mockRequest } from "@/lib/test-helpers";
import {
  setSession,
  mockResolveAiProvider,
  mockSaveMessage,
  mockRunAgentTurn,
  readSseBody,
  route,
  resetMocks,
} from "./route-harness";

describe("POST /api/chat/send — honest failure causes (E1)", () => {
  // The route decides why Sage could not answer and sends it as `failure`.
  // The client never parses the text for the cause.
  const previousAgentFlag = process.env.SAGE_AGENT_ENABLED;
  const previousAgentMode = process.env.SAGE_AGENT_MODE;
  let sageFailure: typeof import("@/lib/chat/sage-failure");

  before(async () => {
    sageFailure = await import("@/lib/chat/sage-failure");
  });

  function useAgentLoop(mode: "off" | "readonly") {
    if (mode === "off") {
      process.env.SAGE_AGENT_ENABLED = "false";
      delete process.env.SAGE_AGENT_MODE;
    } else {
      process.env.SAGE_AGENT_MODE = mode;
      delete process.env.SAGE_AGENT_ENABLED;
    }
  }

  beforeEach(() => {
    resetMocks();
    useAgentLoop("off");
  });
  after(() => {
    if (previousAgentFlag === undefined) delete process.env.SAGE_AGENT_ENABLED;
    else process.env.SAGE_AGENT_ENABLED = previousAgentFlag;
    if (previousAgentMode === undefined) delete process.env.SAGE_AGENT_MODE;
    else process.env.SAGE_AGENT_MODE = previousAgentMode;
  });

  const NORMAL_MESSAGE = "How do I finish my OSHA 10 certification?";
  const CRISIS_MESSAGE = "I just want to end it all";
  const EN_BLOCK = /call or text 988/;

  function post(message: string) {
    const req = mockRequest("/api/chat/send", { method: "POST", body: { message } });
    return route.POST(req as never, { params: Promise.resolve({}) } as never);
  }

  function failingProvider(error: Error) {
    return {
      name: "ollama",
      async generateResponse(): Promise<string> {
        throw error;
      },
      async *streamResponse(): AsyncGenerator<string> {
        throw error;
      },
      async *streamWithTools(): AsyncGenerator<never> {
        throw error;
      },
      async generateStructuredResponse() {
        return "{}";
      },
    };
  }

  /** The SSE error event's JSON, or a failed assertion. */
  function errorEvent(body: string): { error: string; failure?: unknown } {
    const line = body
      .split("\n")
      .find((l) => l.startsWith("data: ") && l.includes('"error"'));
    assert.ok(line, `expected an SSE error event in: ${body}`);
    return JSON.parse(line!.slice("data: ".length)) as { error: string; failure?: unknown };
  }

  function userMessageSaved(): boolean {
    return mockSaveMessage.mock.calls.some((call) => call.arguments[2] === "user");
  }

  describe("before the stream opens (provider setup)", () => {
    const setupCases: Array<[string, string, "off" | "not_set_up" | "unknown"]> = [
      ["no model configured", "Local AI server URL is not configured. Set it in Program Setup > AI Provider.", "not_set_up"],
      ["the server cannot be reached", "Local AI server unreachable", "off"],
      ["an unknown failure", "database went away", "unknown"],
    ];

    for (const [label, message, code] of setupCases) {
      it(`${label}: 503 with failure "${code}" and no "not lost" claim`, async () => {
        mockResolveAiProvider.mock.mockImplementation(async () => {
          throw new Error(message);
        });
        const res = await post(NORMAL_MESSAGE);
        assert.equal(res.status, 503);
        const body = (await res.json()) as { error: string; failure?: unknown };
        assert.equal(body.failure, code);
        assert.equal(
          body.error,
          sageFailure.sageFailureMessage(code, { audience: "student", messageSaved: false }),
        );
        // The claim is withheld because it would be false: nothing was saved.
        assert.equal(userMessageSaved(), false);
      });
    }

    it("never sends a student API-key instructions", async () => {
      mockResolveAiProvider.mock.mockImplementation(async () => {
        throw new Error("Sage is not configured yet (no API key).");
      });
      const body = (await (await post(NORMAL_MESSAGE)).json()) as { error: string };
      assert.doesNotMatch(body.error, /API|key|Settings/i);
    });

    it("gives staff the staff wording", async () => {
      setSession(mockTeacherSession());
      mockResolveAiProvider.mock.mockImplementation(async () => {
        throw new Error("Local AI server URL is not configured.");
      });
      const body = (await (await post("How is my class doing?")).json()) as { error: string; failure?: unknown };
      assert.equal(body.failure, "not_set_up");
      assert.equal(
        body.error,
        sageFailure.sageFailureMessage("not_set_up", { audience: "staff", messageSaved: false }),
      );
    });
  });

  describe("after the stream opens", () => {
    const streamCases: Array<[string, Error, "off" | "busy" | "slow" | "unknown"]> = [
      ["the relay has no Mac (502)", new Error("Local AI stream failed (502)"), "off"],
      ["the relay is at capacity (503)", new Error("Local AI stream failed (503)"), "busy"],
      ["no first reply in time", new Error("Local AI did not produce a first content token within 45 seconds."), "slow"],
      ["an unknown failure", new Error("kaboom"), "unknown"],
    ];

    for (const mode of ["off", "readonly"] as const) {
      for (const [label, error, code] of streamCases) {
        it(`agent loop ${mode}: ${label} sends failure "${code}" and says the message was saved`, async () => {
          useAgentLoop(mode);
          // The real agent loop catches the provider error and reports only
          // agent_stop { reason: "error" }; this double does the same.
          mockRunAgentTurn.mock.mockImplementation(async function* (args: { provider: { streamWithTools: () => AsyncGenerator<unknown> } }) {
            try {
              for await (const event of args.provider.streamWithTools()) void event;
            } catch {
              yield { type: "agent_stop", reason: "error", transcript: [], finalText: "" };
            }
          });
          mockResolveAiProvider.mock.mockImplementation(async () => failingProvider(error));

          const event = errorEvent(await readSseBody(await post(NORMAL_MESSAGE)));
          assert.equal(event.failure, code);
          assert.equal(
            event.error,
            sageFailure.sageFailureMessage(code, { audience: "student", messageSaved: true }),
          );
          assert.equal(userMessageSaved(), true);
        });
      }
    }
  });

  describe("the 988 block stays on every failure path that had it", () => {
    for (const [label, message] of [
      ["not set up", "Local AI server URL is not configured."],
      ["off", "Local AI server unreachable"],
      ["unknown", "database went away"],
    ] as const) {
      it(`provider setup, ${label}: the error carries the block for a crisis message`, async () => {
        mockResolveAiProvider.mock.mockImplementation(async () => {
          throw new Error(message);
        });
        const body = (await (await post(CRISIS_MESSAGE)).json()) as { error: string };
        assert.match(body.error, EN_BLOCK);
      });
    }

    for (const [label, message] of [
      ["off", "Local AI stream failed (502)"],
      ["busy", "Local AI stream failed (503)"],
      ["slow", "Local AI did not produce a first content token within 45 seconds."],
      ["unknown", "kaboom"],
    ] as const) {
      it(`stream, ${label}: the error event carries the block for a crisis message`, async () => {
        mockResolveAiProvider.mock.mockImplementation(async () => failingProvider(new Error(message)));
        const event = errorEvent(await readSseBody(await post(CRISIS_MESSAGE)));
        assert.match(event.error, EN_BLOCK);
        assert.ok(event.error.startsWith("Sage "), event.error);
      });
    }
  });
});
