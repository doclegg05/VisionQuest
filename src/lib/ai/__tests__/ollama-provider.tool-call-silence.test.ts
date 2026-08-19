/**
 * Silent-empty regression suite for the non-streaming completion paths.
 *
 * A local model that ends its turn by CALLING A TOOL the caller never
 * declared comes back as `{"role":"assistant","content":""}` — no error, no
 * tool_calls array, `done_reason: "stop"`. `generateResponse` used to hand
 * that "" straight to its caller, which is how the same one-character
 * symptom cost two debugging sessions (project memory, 2026-07-27).
 *
 * The three surfaces differ in how much they admit:
 *   - /v1/chat/completions reports `finish_reason: "tool_calls"` and may
 *     carry the parsed `message.tool_calls`.
 *   - native /api/chat reports `message.tool_calls` when the caller DID
 *     declare tools.
 *   - native /api/chat with NO tools declared reports nothing at all: the
 *     call is stripped by Ollama's built-in gemma-family parser and there is
 *     nowhere to put it.
 *
 * These tests pin the contract for all three: an empty completion is never a
 * return value, and the error names the cause only where the wire proves it.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "../ollama-provider";

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

/** First call 404s the OpenAI path so the provider falls through to native. */
function nativeAfter404(nativeResponse: () => Response): void {
  let calls = 0;
  mockFetch.mock.mockImplementation(async () => {
    calls += 1;
    if (calls === 1) return new Response("Not Found", { status: 404 });
    return nativeResponse();
  });
}

describe("OllamaProvider empty completions", { concurrency: false }, () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    mockFetch.mock.resetCalls();
    mockFetch.mock.mockImplementation(async () => {
      throw new Error("Unexpected fetch call in OllamaProvider test");
    });
    provider = new OllamaProvider("http://localhost:11434", "gemma4:latest");
  });

  describe("a tool-call finish with no visible content", () => {
    it("generateResponse throws on a /v1 finish_reason of tool_calls", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [{ finish_reason: "tool_calls", message: { content: "" } }],
          usage: { prompt_tokens: 4579, completion_tokens: 12 },
        }),
      );

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /tool call/i,
      );
    });

    it("generateResponse throws when /v1 returns a parsed tool_calls array", async () => {
      // Some OpenAI-compatible servers report finish_reason "stop" but still
      // attach the parsed call — the array is the signal, not the reason.
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "find_certification", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
      );

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /tool call/i,
      );
    });

    it("generateResponse throws on a native tool_calls array", async () => {
      nativeAfter404(() =>
        Response.json({
          message: {
            content: "",
            tool_calls: [
              { function: { name: "lookup_program_info", arguments: { topic: "certs" } } },
            ],
          },
          done: true,
          done_reason: "stop",
        }),
      );

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /tool call/i,
      );
    });

    it("generateStructuredResponse throws rather than returning unparseable ''", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [{ finish_reason: "tool_calls", message: { content: "" } }],
        }),
      );

      await assert.rejects(
        provider.generateStructuredResponse("sys", [{ role: "user", content: "Hi" }]),
        /tool call/i,
      );
    });

    it("names the tool the model tried to call so the fix is obvious", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "find_certification", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
      );

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /find_certification/,
      );
    });

    /** Text alongside a tool call is a usable reply — must still pass through. */
    it("returns the text when a tool-call finish also produced content", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [
            {
              finish_reason: "tool_calls",
              message: { content: "Let me check that for you." },
            },
          ],
        }),
      );

      const result = await provider.generateResponse("sys", [
        { role: "user", content: "Hi" },
      ]);

      assert.equal(result, "Let me check that for you.");
    });
  });

  describe("an empty completion with no signal at all", () => {
    /**
     * Native /api/chat with no tools declared cannot tell us WHY the turn was
     * empty — the parser drops the call and leaves `done_reason: "stop"`.
     * The error must therefore not claim a tool call it cannot see, and must
     * not blame reasoning either (that is a different, budget-shaped bug).
     */
    it("generateResponse throws without inventing a cause", async () => {
      nativeAfter404(() =>
        Response.json({ message: { content: "" }, done: true, done_reason: "stop" }),
      );

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        (error: Error) => {
          assert.match(error.message, /empty reply/i);
          assert.doesNotMatch(error.message, /reasoning/i);
          return true;
        },
      );
    });

    it("generateStructuredResponse throws on the /v1 path too", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({ choices: [{ finish_reason: "stop", message: { content: "" } }] }),
      );

      await assert.rejects(
        provider.generateStructuredResponse("sys", [{ role: "user", content: "Hi" }]),
        /empty reply/i,
      );
    });

    /** The spend still has to reach the ledger before the throw. */
    it("reports usage before throwing", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [{ finish_reason: "tool_calls", message: { content: "" } }],
          usage: { prompt_tokens: 4579, completion_tokens: 12, total_tokens: 4591 },
        }),
      );

      const usages: Array<{ inputTokens: number; outputTokens: number }> = [];
      await assert.rejects(
        provider.generateResponse(
          "sys",
          [{ role: "user", content: "Hi" }],
          (usage) => usages.push(usage),
        ),
      );

      assert.equal(usages.length, 1);
      assert.equal(usages[0].inputTokens, 4579);
      assert.equal(usages[0].outputTokens, 12);
    });
  });
});
