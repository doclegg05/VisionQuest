// Test preload: answers every OpenRouter request with STUB_OPENROUTER_STATUS
// and refuses every other request, so an eval run under it never reaches the
// network. STUB_OPENROUTER_STATUS=network fails every request the way fetch
// does when the connection never happens. STUB_OPENROUTER_STATUS=ok answers
// with a one-word reply whose usage bills STUB_OPENROUTER_COST USD (default
// 0.0005), as OpenRouter's usage does, and an embeddings request with one
// 768-dimension vector per input. STUB_OPENROUTER_STATUS=unknown-model
// answers chat and embeddings requests with the 400 OpenRouter sends for a
// model id it does not know; a plain 400 is a request-shape rejection. Used by
// scripts/lib/eval-abort.e2e.test.mjs.
const mode = process.env.STUB_OPENROUTER_STATUS ?? "402";
const networkDown = mode === "network";
const ok = mode === "ok";
const unknownModel = mode === "unknown-model";
const status = unknownModel ? 400 : Number(mode);
const cost = Number(process.env.STUB_OPENROUTER_COST ?? "0.0005");
const bodies = {
  400: { error: { code: 400, message: "messages.1.content: Expected string, received array" } },
  402: { error: { code: 402, message: "Insufficient credits" } },
  404: { error: { code: 404, message: "No endpoints found matching your data policy" } },
};
const UNKNOWN_MODEL_BODY = { error: { code: 400, message: "stub/no-such-model is not a valid model ID" } };

/** An embeddings reply: one 768-dimension vector per input, as OpenRouter's /v1/embeddings returns. */
function okEmbeddings(init) {
  const input = JSON.parse(String(init?.body ?? "{}")).input;
  const count = Array.isArray(input) ? input.length : 1;
  const embedding = Array.from({ length: 768 }, (_, index) => (index === 0 ? 1 : 0));
  const data = Array.from({ length: count }, (_, index) => ({ embedding, index }));
  return new Response(JSON.stringify({ data, usage: { prompt_tokens: count, cost } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function okReply(init) {
  const usage = { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11, cost };
  const streaming = JSON.parse(String(init?.body ?? "{}")).stream === true;
  if (!streaming) {
    return new Response(JSON.stringify({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  const events = [{ choices: [{ delta: { content: "OK" } }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage }];
  const text = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.includes("openrouter.ai")) throw new Error(`stub fetch refused a non-OpenRouter request: ${url}`);
  if (networkDown) throw new TypeError("fetch failed");
  if (ok) return url.endsWith("/embeddings") ? okEmbeddings(init) : okReply(init);
  const body = unknownModel ? UNKNOWN_MODEL_BODY : (bodies[status] ?? { error: { code: status } });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
};
