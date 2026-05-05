import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "../ollama-provider";

const mockFetch = mock.fn<typeof globalThis.fetch>();
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

describe("OllamaProvider", { concurrency: false }, () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    mockFetch.mock.resetCalls();
    mockFetch.mock.mockImplementation(async () => {
      throw new Error("Unexpected fetch call in OllamaProvider test");
    });
    provider = new OllamaProvider("http://localhost:11434", "gemma4:26b");
  });

  describe("generateResponse", () => {
    it("sends correct request and returns response text", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [{ message: { content: "Hello there!" } }],
        }),
      );

      const result = await provider.generateResponse("Be helpful.", [
        { role: "user", content: "Hi" },
      ]);

      assert.equal(result, "Hello there!");

      const call = mockFetch.mock.calls[0];
      assert.equal(call.arguments[0], "http://localhost:11434/v1/chat/completions");
      const body = JSON.parse((call.arguments[1] as RequestInit).body as string);
      assert.equal(body.model, "gemma4:26b");
      assert.equal(body.stream, false);
      assert.equal(body.num_ctx, 8192);
      assert.deepEqual(body.messages[0], { role: "system", content: "Be helpful." });
      assert.deepEqual(body.messages[1], { role: "user", content: "Hi" });
    });

    it("throws on non-ok response", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        new Response("Internal Server Error", { status: 500 }),
      );

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /Local AI request failed \(500\)/,
      );
    });

    it("falls back to native Ollama chat when the OpenAI path returns 404", async () => {
      let fetchCount = 0;
      mockFetch.mock.mockImplementation(async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Response("Not Found", { status: 404 });
        }
        return Response.json({
          message: { content: "Hello from native Ollama!" },
        });
      });

      const result = await provider.generateResponse("Be helpful.", [
        { role: "user", content: "Hi" },
      ]);

      assert.equal(result, "Hello from native Ollama!");
      assert.equal(mockFetch.mock.calls[0].arguments[0], "http://localhost:11434/v1/chat/completions");
      assert.equal(mockFetch.mock.calls[1].arguments[0], "http://localhost:11434/api/chat");
    });
  });

  describe("generateStructuredResponse", () => {
    it("sets response_format for JSON output", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [{ message: { content: '{"goals_found":[]}' } }],
        }),
      );

      const result = await provider.generateStructuredResponse("Extract goals.", [
        { role: "user", content: "I want to learn coding" },
      ]);

      assert.equal(result, '{"goals_found":[]}');
      const body = JSON.parse(
        (mockFetch.mock.calls[0].arguments[1] as RequestInit).body as string,
      );
      assert.deepEqual(body.response_format, { type: "json_object" });
    });

    it("falls back to native JSON mode when the OpenAI path returns 404", async () => {
      let fetchCount = 0;
      mockFetch.mock.mockImplementation(async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Response("Not Found", { status: 404 });
        }
        return Response.json({
          message: { content: '{"goals_found":[]}' },
        });
      });

      const result = await provider.generateStructuredResponse("Extract goals.", [
        { role: "user", content: "I want to learn coding" },
      ]);

      assert.equal(result, '{"goals_found":[]}');
      const nativeBody = JSON.parse(
        (mockFetch.mock.calls[1].arguments[1] as RequestInit).body as string,
      );
      assert.equal(nativeBody.format, "json");
      assert.deepEqual(nativeBody.options, { num_ctx: 8192 });
    });
  });

  describe("num_ctx override", () => {
    it("uses an explicit numCtx in OpenAI-mode requests when provided", async () => {
      const customProvider = new OllamaProvider(
        "http://localhost:11434",
        "gemma4:26b",
        { authMode: "none", numCtx: 32768 },
      );

      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({ choices: [{ message: { content: "ok" } }] }),
      );

      await customProvider.generateResponse("sys", [
        { role: "user", content: "Hi" },
      ]);

      const body = JSON.parse(
        (mockFetch.mock.calls[0].arguments[1] as RequestInit).body as string,
      );
      assert.equal(body.num_ctx, 32768);
    });

    it("falls back to the default 8192 when no override is provided", () => {
      const defaultProvider = new OllamaProvider(
        "http://localhost:11434",
        "gemma4:26b",
      );
      // Static default exposed for clarity / future verification.
      assert.equal(OllamaProvider.DEFAULT_NUM_CTX, 8192);
      // No public getter — assert via behavior in subsequent tests.
      assert.ok(defaultProvider);
    });
  });

  describe("streamResponse", () => {
    it("yields chunks from SSE stream", async () => {
      const encoder = new TextEncoder();
      const chunks = [
        "data: " + JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }) + "\n\n",
        "data: " + JSON.stringify({ choices: [{ delta: { content: " world" } }] }) + "\n\n",
        "data: [DONE]\n\n",
      ];

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      mockFetch.mock.mockImplementationOnce(
        async () => new Response(stream, { status: 200 }),
      );

      const result: string[] = [];
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ])) {
        result.push(chunk);
      }

      assert.deepEqual(result, ["Hello", " world"]);
      const body = JSON.parse(
        (mockFetch.mock.calls[0].arguments[1] as RequestInit).body as string,
      );
      assert.equal(body.stream, true);
      assert.equal(body.num_ctx, 8192);
    });

    it("falls back to native streamed chat when the OpenAI path returns 404", async () => {
      const encoder = new TextEncoder();
      const nativeChunks = [
        JSON.stringify({
          message: { content: "Hello" },
          done: false,
        }) + "\n",
        JSON.stringify({
          message: { content: " world" },
          done: false,
        }) + "\n",
        JSON.stringify({
          message: { content: "" },
          done: true,
        }) + "\n",
      ];

      const nativeStream = new ReadableStream({
        start(controller) {
          for (const chunk of nativeChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      let fetchCount = 0;
      mockFetch.mock.mockImplementation(async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Response("Not Found", { status: 404 });
        }
        return new Response(nativeStream, { status: 200 });
      });

      const result: string[] = [];
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ])) {
        result.push(chunk);
      }

      assert.deepEqual(result, ["Hello", " world"]);
      assert.equal(mockFetch.mock.calls[1].arguments[0], "http://localhost:11434/api/chat");
    });

    it("retries a relay startup error before any tokens are yielded", async () => {
      const encoder = new TextEncoder();
      let fetchCount = 0;

      mockFetch.mock.mockImplementation(async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(": heartbeat\n\n"));
                controller.enqueue(
                  encoder.encode(
                    'data: {"error":"Relay: connect ECONNREFUSED 127.0.0.1:11434"}\n\n',
                  ),
                );
                controller.close();
              },
            }),
            { status: 200 },
          );
        }

        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  "data: " +
                    JSON.stringify({ choices: [{ delta: { content: "Recovered" } }] }) +
                    "\n\n",
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200 },
        );
      });

      const result: string[] = [];
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ])) {
        result.push(chunk);
      }

      assert.deepEqual(result, ["Recovered"]);
      assert.equal(fetchCount, 2);
    });

    it("switches to native streaming when the relay hides an OpenAI-path 404 inside the stream", async () => {
      const encoder = new TextEncoder();
      let fetchCount = 0;

      mockFetch.mock.mockImplementation(async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(": heartbeat\n\n"));
                controller.enqueue(
                  encoder.encode('data: {"error":"Ollama returned 404"}\n\n'),
                );
                controller.close();
              },
            }),
            { status: 200 },
          );
        }

        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({ message: { content: "Native" }, done: false }) +
                    "\n",
                ),
              );
              controller.enqueue(
                encoder.encode(JSON.stringify({ message: { content: "" }, done: true }) + "\n"),
              );
              controller.close();
            },
          }),
          { status: 200 },
        );
      });

      const result: string[] = [];
      for await (const chunk of provider.streamResponse("sys", [
        { role: "user", content: "Hi" },
      ])) {
        result.push(chunk);
      }

      assert.deepEqual(result, ["Native"]);
      assert.equal(mockFetch.mock.calls[1].arguments[0], "http://localhost:11434/api/chat");
      assert.equal(fetchCount, 2);
    });
  });

  describe("message role mapping", () => {
    it("maps 'model' role to 'assistant' for OpenAI format", async () => {
      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [{ message: { content: "ok" } }],
        }),
      );

      await provider.generateResponse("sys", [
        { role: "user", content: "Hi" },
        { role: "model", content: "Hello" },
        { role: "user", content: "How are you?" },
      ]);

      const body = JSON.parse(
        (mockFetch.mock.calls[0].arguments[1] as RequestInit).body as string,
      );
      assert.deepEqual(body.messages[1], { role: "user", content: "Hi" });
      assert.deepEqual(body.messages[2], { role: "assistant", content: "Hello" });
      assert.deepEqual(body.messages[3], { role: "user", content: "How are you?" });
    });
  });

  describe("auth headers", () => {
    it("sends bearer auth when configured", async () => {
      provider = new OllamaProvider("http://localhost:11434", "gemma4:26b", {
        authMode: "bearer",
        apiKey: "test-token",
      });

      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [{ message: { content: "ok" } }],
        }),
      );

      await provider.generateResponse("sys", [
        { role: "user", content: "Hi" },
      ]);

      const headers = (mockFetch.mock.calls[0].arguments[1] as RequestInit)
        .headers as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer test-token");
    });

    it("sends Cloudflare Access service-token headers when configured", async () => {
      provider = new OllamaProvider("http://localhost:11434", "gemma4:26b", {
        authMode: "cloudflare_service_token",
        cloudflareAccessClientId: "client-id",
        cloudflareAccessClientSecret: "client-secret",
      });

      mockFetch.mock.mockImplementationOnce(async () =>
        Response.json({
          choices: [{ message: { content: "ok" } }],
        }),
      );

      await provider.generateResponse("sys", [
        { role: "user", content: "Hi" },
      ]);

      const headers = (mockFetch.mock.calls[0].arguments[1] as RequestInit)
        .headers as Record<string, string>;
      assert.equal(headers["CF-Access-Client-Id"], "client-id");
      assert.equal(headers["CF-Access-Client-Secret"], "client-secret");
    });

    it("throws when bearer auth is selected without a token", async () => {
      provider = new OllamaProvider("http://localhost:11434", "gemma4:26b", {
        authMode: "bearer",
      });

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /bearer token is not configured/i,
      );
    });

    it("throws when Cloudflare auth is selected without both credentials", async () => {
      provider = new OllamaProvider("http://localhost:11434", "gemma4:26b", {
        authMode: "cloudflare_service_token",
        cloudflareAccessClientId: "client-id",
      });

      await assert.rejects(
        provider.generateResponse("sys", [{ role: "user", content: "Hi" }]),
        /cloudflare access service token is not configured/i,
      );
    });
  });

  describe("streamWithTools", () => {
    const tools = [
      {
        name: "lookup_thing",
        description: "Look up a thing.",
        parameters: {
          type: "object" as const,
          properties: {
            id: { type: "string" as const, description: "Thing id" },
          },
          required: ["id"],
        },
      },
    ];

    function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      });
    }

    it("streams text only when the model emits no tool calls", async () => {
      const chunks = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hi" } }] })}\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: " there" } }] })}\n`,
        `data: [DONE]\n`,
      ];
      mockFetch.mock.mockImplementationOnce(
        async () => new Response(streamFromChunks(chunks), { status: 200 }),
      );

      const onToolCall = mock.fn(async () => ({
        response: {},
        summary: "unused",
        status: "success" as const,
      }));

      const events: unknown[] = [];
      for await (const event of provider.streamWithTools(
        "sys",
        [{ role: "user", content: "Hi" }],
        tools,
        onToolCall,
      )) {
        events.push(event);
      }

      const text = events
        .filter((e): e is { kind: "text"; text: string } => (e as { kind: string }).kind === "text")
        .map((e) => e.text)
        .join("");
      assert.equal(text, "Hi there");
      assert.equal(onToolCall.mock.callCount(), 0);
      assert.equal((events.at(-1) as { kind: string; reason: string }).kind, "done");
      assert.equal((events.at(-1) as { reason: string }).reason, "complete");

      // Tools were forwarded in the request body.
      const body = JSON.parse((mockFetch.mock.calls[0].arguments[1] as RequestInit).body as string);
      assert.equal(body.tools[0].function.name, "lookup_thing");
      assert.equal(body.stream, true);
    });

    it("invokes onToolCall with parsed args and feeds responses back into the next hop", async () => {
      // Hop 1: model emits a tool call.
      const hop1Chunks = [
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call-1", function: { name: "lookup_thing" } },
                ],
              },
            },
          ],
        })}\n`,
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '{"id":"abc' } },
                ],
              },
            },
          ],
        })}\n`,
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '"}' } },
                ],
              },
            },
          ],
        })}\n`,
        `data: [DONE]\n`,
      ];
      // Hop 2: after tool result, model replies with text.
      const hop2Chunks = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Got it." } }] })}\n`,
        `data: [DONE]\n`,
      ];

      let fetchCount = 0;
      mockFetch.mock.mockImplementation(async () => {
        fetchCount += 1;
        const stream = fetchCount === 1 ? hop1Chunks : hop2Chunks;
        return new Response(streamFromChunks(stream), { status: 200 });
      });

      const onToolCall = mock.fn(async () => ({
        response: { found: true, label: "Thing ABC" },
        summary: "Found it.",
        status: "success" as const,
      }));

      const events: Array<{ kind: string; [k: string]: unknown }> = [];
      for await (const event of provider.streamWithTools(
        "sys",
        [{ role: "user", content: "Find abc." }],
        tools,
        onToolCall,
      )) {
        events.push(event as { kind: string });
      }

      const tcEvent = events.find((e) => e.kind === "tool_call");
      assert.ok(tcEvent, "expected a tool_call event");
      assert.equal((tcEvent as { name: string }).name, "lookup_thing");
      assert.deepEqual((tcEvent as { args: unknown }).args, { id: "abc" });

      assert.equal(onToolCall.mock.callCount(), 1);

      const trEvent = events.find((e) => e.kind === "tool_result");
      assert.ok(trEvent, "expected a tool_result event");
      assert.equal((trEvent as { status: string }).status, "success");

      // Final text reply visible after the tool round-trip.
      const finalText = events
        .filter((e) => e.kind === "text")
        .map((e) => (e as { text: string }).text)
        .join("");
      assert.equal(finalText, "Got it.");

      // Hop 2 conversation should include the tool response message.
      const hop2Body = JSON.parse(
        (mockFetch.mock.calls[1].arguments[1] as RequestInit).body as string,
      );
      const toolMsg = hop2Body.messages.find(
        (m: { role: string }) => m.role === "tool",
      );
      assert.ok(toolMsg, "hop 2 should carry the tool-role message back to the model");
      assert.equal(toolMsg.tool_call_id, "call-1");
    });

    it("stops at maxHops when the model loops on tool calls", async () => {
      const loopChunks = [
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "stuck", function: { name: "lookup_thing", arguments: '{"id":"x"}' } },
                ],
              },
            },
          ],
        })}\n`,
        `data: [DONE]\n`,
      ];
      mockFetch.mock.mockImplementation(
        async () => new Response(streamFromChunks(loopChunks), { status: 200 }),
      );

      const onToolCall = mock.fn(async () => ({
        response: {},
        summary: "ran",
        status: "success" as const,
      }));

      const events: Array<{ kind: string; reason?: string }> = [];
      for await (const event of provider.streamWithTools(
        "sys",
        [{ role: "user", content: "Loop forever." }],
        tools,
        onToolCall,
        { maxHops: 2 },
      )) {
        events.push(event as { kind: string; reason?: string });
      }

      // Two hops × one tool call each = 2 invocations.
      assert.equal(onToolCall.mock.callCount(), 2);
      const last = events.at(-1);
      assert.equal(last?.kind, "done");
      assert.equal(last?.reason, "max_hops");
    });
  });
});
