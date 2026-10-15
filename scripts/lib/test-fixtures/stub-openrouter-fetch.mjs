// Test preload: answers every OpenRouter request with STUB_OPENROUTER_STATUS
// and refuses every other request, so an eval run under it never reaches the
// network. STUB_OPENROUTER_STATUS=network fails every request the way fetch
// does when the connection never happens. STUB_OPENROUTER_STATUS=ok answers
// with a one-word reply whose usage bills STUB_OPENROUTER_COST USD (default
// 0.0005), as OpenRouter's usage does. STUB_OPENROUTER_RECORD=<file> appends
// one JSON line per request (its URL, and for an OpenRouter request the model
// and routing rule it asked for; a refused request is recorded as refused), so
// a test can show where a run's calls went. Used by
// scripts/lib/eval-abort.e2e.test.mjs and
// scripts/bench/suites/lib/chat-harness-family.e2e.test.mjs.
import { appendFileSync } from "node:fs";

const networkDown = process.env.STUB_OPENROUTER_STATUS === "network";
const ok = process.env.STUB_OPENROUTER_STATUS === "ok";
const status = Number(process.env.STUB_OPENROUTER_STATUS ?? "402");
const cost = Number(process.env.STUB_OPENROUTER_COST ?? "0.0005");
const bodies = {
  402: { error: { code: 402, message: "Insufficient credits" } },
  404: { error: { code: 404, message: "No endpoints found matching your data policy" } },
};

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

const recordPath = process.env.STUB_OPENROUTER_RECORD;

function record(entry) {
  if (recordPath) appendFileSync(recordPath, `${JSON.stringify(entry)}\n`);
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.includes("openrouter.ai")) {
    record({ url, refused: true });
    throw new Error(`stub fetch refused a non-OpenRouter request: ${url}`);
  }
  const body = JSON.parse(String(init?.body ?? "{}"));
  record({ url, model: body.model ?? null, routing: body.provider ?? null });
  if (networkDown) throw new TypeError("fetch failed");
  if (ok) return okReply(init);
  return new Response(JSON.stringify(bodies[status] ?? { error: { code: status } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
};
