import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { WebSocket } from "ws";
import { startRelay } from "./server.mjs";
import { connectMacAgent } from "./agent.mjs";
import { AGENT_PATH, allowedRequest } from "./protocol.mjs";

const agentToken = "a".repeat(64);
const appToken = "b".repeat(64);
const headers = { authorization: `Bearer ${appToken}`, "content-type": "application/json" };
const body = JSON.stringify({ model: "gemma4:12b", messages: [{ role: "user", content: "synthetic" }], stream: true });
async function server(handler) {
  const s = http.createServer(handler); s.listen(0, "127.0.0.1"); await once(s, "listening"); return s;
}
async function until(predicate) {
  const end = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > end) throw new Error("Condition timed out"); await new Promise((r) => setTimeout(r, 10)); }
}
async function setup(t, handler, options = {}) {
  const received = [];
  const upstream = await server(async (req, res) => {
    let input = ""; for await (const chunk of req) input += chunk;
    received.push({ path: req.url, authorization: req.headers.authorization, body: input });
    if (handler) return handler(req, res);
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.write('{"message":{"content":"local "}}\n');
    setTimeout(() => res.end('{"message":{"content":"reply"},"done":true}\n'), 20);
  });
  const next = await server((req, res) => { if (options.nextHandler) return options.nextHandler(req, res); res.writeHead(200, { "x-test-proxy": "yes" }); res.end(req.headers.host + req.url); });
  const relay = await startRelay({ agentToken, appToken, publicPort: 0, publicHost: "127.0.0.1", localPort: 0, nextPort: next.address().port, ...options });
  const url = `http://127.0.0.1:${relay.local.address().port}`;
  const publicUrl = `http://127.0.0.1:${relay.front.address().port}`;
  let agent;
  const connect = () => {
    agent = connectMacAgent({ relayUrl: publicUrl.replace("http:", "ws:") + AGENT_PATH, agentToken, upstreamUrl: `http://127.0.0.1:${upstream.address().port}`, allowLoopbackWs: true, backgroundGraceMs: options.backgroundGraceMs ?? 0 });
    return agent;
  };
  t.after(async () => {
    agent?.stop(); await relay.close();
    for (const s of [upstream, next]) { s.closeAllConnections(); await new Promise((r) => s.close(r)); }
  });
  return { relay, connect, url, publicUrl, received };
}

test("proxy preserves app routes and relay refuses unauthenticated/offline callers", async (t) => {
  const x = await setup(t);
  const proxied = await fetch(x.publicUrl + "/api/health?probe=1");
  assert.equal(proxied.headers.get("x-test-proxy"), "yes");
  assert.match(await proxied.text(), /\/api\/health\?probe=1$/);
  assert.equal((await fetch(x.publicUrl + AGENT_PATH)).status, 404);
  assert.equal((await fetch(x.url + "/api/chat", { method: "POST", body })).status, 401);
  assert.equal((await fetch(x.url + "/api/chat", { method: "POST", body, headers })).status, 503);
  assert.equal(x.received.length, 0);
});

test("authenticated Mac streams the pinned model and receives no relay credentials", async (t) => {
  const x = await setup(t); x.connect(); await until(x.relay.connected);
  const response = await fetch(x.url + "/api/chat", { method: "POST", body, headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-ndjson");
  assert.match(await response.text(), /local .*reply/s);
  assert.equal(x.received.length, 1);
  assert.equal(x.received[0].authorization, undefined);
  assert.equal(JSON.parse(x.received[0].body).model, "gemma4:12b");
});

test("model changes, pull/delete endpoints and arbitrary URLs never reach the Mac", async (t) => {
  const x = await setup(t); x.connect(); await until(x.relay.connected);
  for (const [path, input] of [["/api/pull", body], ["/api/delete", body], ["/api/chat", JSON.stringify({ model: "gemma4:cloud" })], ["/api/chat?url=https://example.com", body], ["/api/embed", body]]) {
    assert.equal((await fetch(x.url + path, { method: "POST", body: input, headers })).status, 400);
  }
  assert.equal(x.received.length, 0);
});

test("wrong credentials, browser origin and a second Mac cannot take over", async (t) => {
  const x = await setup(t);
  async function rejected(auth, origin) {
    const ws = new WebSocket(x.publicUrl.replace("http:", "ws:") + AGENT_PATH, { headers: { authorization: auth, ...(origin ? { origin } : {}) } });
    ws.on("error", () => {});
    const [req, res] = await once(ws, "unexpected-response");
    assert.ok(req); res.resume(); ws.terminate(); return res.statusCode;
  }
  assert.equal(await rejected("Bearer wrong"), 401);
  assert.equal(await rejected(`Bearer ${agentToken}`, "https://example.com"), 401);
  x.connect(); await until(x.relay.connected);
  assert.equal(await rejected(`Bearer ${agentToken}`), 409);
});

test("connection loss fails pending work and never replays it", async (t) => {
  const x = await setup(t, () => {}); const agent = x.connect(); await until(x.relay.connected);
  const pending = fetch(x.url + "/api/chat", { method: "POST", body, headers });
  await until(() => x.received.length === 1); agent.stop();
  assert.equal((await pending).status, 503);
  await until(() => !x.relay.connected());
  assert.equal((await fetch(x.url + "/api/chat", { method: "POST", body, headers })).status, 503);
  assert.equal(x.received.length, 1);
});

test("request timeout cancels slow local inference", async (t) => {
  const x = await setup(t, () => {}, { requestTimeout: 80 }); x.connect(); await until(x.relay.connected);
  assert.equal((await fetch(x.url + "/api/chat", { method: "POST", body, headers })).status, 504);
});

test("insecure production transport and non-loopback models are rejected", () => {
  assert.throws(() => connectMacAgent({ relayUrl: "ws://example.com" + AGENT_PATH, agentToken }), /secure/);
  assert.throws(() => connectMacAgent({ relayUrl: "wss://visionquest.onrender.com" + AGENT_PATH, agentToken, upstreamUrl: "http://example.com" }), /loopback/);
  assert.equal(allowedRequest("POST", "/api/chat", JSON.stringify({ model: "gemma4:12b", options: { num_ctx: 1000000 } })), false);
});


test("Next aborting a partial SSE response terminates the browser response", async (t) => {
  const x = await setup(t, null, { nextHandler: (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: partial\n\n");
    setTimeout(() => res.destroy(), 20);
  } });
  const response = await fetch(x.publicUrl + "/api/chat/send", { signal: AbortSignal.timeout(1500) });
  await assert.rejects(response.text(), /terminated|aborted/);
});

test("malformed private agent configuration never appears in startup logs", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vq-relay-config-"));
  t.after(() => rmSync(dir, { recursive: true }));
  const path = join(dir, "config.json");
  for (const config of ["SECRET-MARKER-invalid-json", JSON.stringify({ relayUrl: "SECRET-MARKER-invalid-url", agentToken })]) {
    writeFileSync(path, config, { mode: 0o600 });
    const result = spawnSync(process.execPath, [new URL("./agent.mjs", import.meta.url).pathname, path], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /could not start/);
    assert.doesNotMatch(result.stdout + result.stderr, /SECRET-MARKER/);
  }
});


test("case-variant model aliases cannot override the pinned model", async (t) => {
  const x = await setup(t); x.connect(); await until(x.relay.connected);
  for (const alias of ["MODEL", "Model", "mOdEl"]) {
    const input = JSON.stringify({ model: "gemma4:12b", [alias]: "gemma4:cloud" });
    assert.equal(allowedRequest("POST", "/api/chat", input), false);
    assert.equal((await fetch(x.url + "/api/chat", { method: "POST", body: input, headers })).status, 400);
  }
  for (const input of ["null", "[]", "{", '{"model":"gemma4:12b"}']) {
    assert.equal(allowedRequest("POST", "/api/chat", input), input.includes("gemma4"));
  }
  assert.equal(x.received.length, 0);
});

test("interactive chat overtakes queued extraction calls without interrupting another chat", async (t) => {
  const responses = [];
  const x = await setup(t, (_req, res) => { responses.push(res); });
  const agent = x.connect(); await until(x.relay.connected);
  const post = (stream, label, signal) => fetch(x.url + "/api/chat", { method: "POST", headers, signal,
    body: JSON.stringify({ model: "gemma4:12b", stream, messages: [{ role: "user", content: label }] }),
  }).then(async (r) => ({ status: r.status, body: await r.text() }));
  const first = post(true, "active foreground");
  await until(() => responses.length === 1);
  const second = post(false, "background two");
  const interactive = post(true, "foreground");
  // Both requests must actually be admitted before releasing the active
  // extraction. A raw FIFO Ollama queue would run background two next.
  await until(() => agent.pending() === 3);
  assert.equal(responses.length, 1, "only one inference may occupy the Mac at once");
  responses[0].end('{"done":true}');
  await first;
  await until(() => responses.length === 2);
  assert.equal(JSON.parse(x.received[1].body).messages[0].content, "foreground");
  responses[1].end('{"done":true}');
  await interactive;
  await until(() => responses.length === 3);
  assert.equal(JSON.parse(x.received[2].body).messages[0].content, "background two");
  responses[2].end('{"done":true}');
  assert.equal((await second).status, 200);
});

test("cancelled queued inference never reaches the Mac and metadata bypasses the queue", async (t) => {
  let release;
  const x = await setup(t, (req, res) => {
    if (req.url === "/api/tags") return res.end('{"models":[]}');
    release = () => res.end('{"done":true}');
  });
  const agent = x.connect(); await until(x.relay.connected);
  const first = fetch(x.url + "/api/chat", { method: "POST", body, headers }).then((r) => r.text());
  await until(() => x.received.length === 1);
  const controller = new AbortController();
  const queued = fetch(x.url + "/api/chat", { method: "POST", body, headers, signal: controller.signal }).catch(() => null);
  await until(() => agent.pending() === 2);
  const metadata = await fetch(x.url + "/api/tags", { headers });
  assert.equal(metadata.status, 200);
  await metadata.text();
  controller.abort(); await queued;
  await until(() => agent.pending() === 1);
  release(); await first;
  await until(() => agent.pending() === 0);
  assert.deepEqual(x.received.map((r) => r.path), ["/api/chat", "/api/tags"]);
});

test("extraction grace lets an arriving chat start first without resetting extraction eligibility", async (t) => {
  const responses = [];
  const x = await setup(t, (_req, res) => { responses.push(res); }, { backgroundGraceMs: 100 });
  const agent = x.connect(); await until(x.relay.connected);
  const extractionBody = JSON.stringify({ model: "gemma4:12b", stream: false, messages: [{ role: "user", content: "extract" }] });
  const extraction = fetch(x.url + "/api/chat", { method: "POST", body: extractionBody, headers }).then((r) => r.text());
  await until(() => agent.pending() === 1);
  assert.equal(x.received.length, 0);
  const chat = fetch(x.url + "/api/chat", { method: "POST", body, headers }).then((r) => r.text());
  await until(() => responses.length === 1);
  assert.equal(JSON.parse(x.received[0].body).stream, true);
  // Let extraction's original grace expire while chat is running.
  await new Promise((r) => setTimeout(r, 110));
  responses[0].end('{"done":true}'); await chat;
  await until(() => responses.length === 2);
  assert.equal(JSON.parse(x.received[1].body).stream, false);
  responses[1].end('{"done":true}'); await extraction;
});

 test("only the two approved local 12B variants cross the relay", () => {
  for (const model of ["gemma4:12b", "gemma4:12b-mlx"]) {
    assert.equal(allowedRequest("POST", "/api/chat", JSON.stringify({ model })), true);
  }
  for (const model of ["gemma4:12b-cloud", "gemma4:26b", "gemma4:12b-mlx-cloud"]) {
    assert.equal(allowedRequest("POST", "/api/chat", JSON.stringify({ model })), false);
  }
});

test("a chat interrupts uncommitted extraction and extraction completes exactly once afterward", async (t) => {
  let attempts = 0;
  let cancelled = false;
  const x = await setup(t, (_req, res) => {
    const input = JSON.parse(x.received.at(-1).body);
    if (input.stream === false && ++attempts === 1) {
      res.on("close", () => { cancelled = true; });
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ result: input.stream === false ? "extraction" : "chat" }));
  });
  x.connect(); await until(x.relay.connected);
  const extraction = fetch(x.url + "/api/chat", { method: "POST", headers,
    body: JSON.stringify({ model: "gemma4:12b", stream: false }),
  }).then((r) => r.json());
  await until(() => attempts === 1);
  const chat = await fetch(x.url + "/api/chat", { method: "POST", headers, body, signal: AbortSignal.timeout(1500) });
  assert.deepEqual(await chat.json(), { result: "chat" });
  assert.deepEqual(await extraction, { result: "extraction" });
  await until(() => cancelled);
  assert.equal(attempts, 2);
});

test("background fan-out leaves room for an interactive request", async (t) => {
  const x = await setup(t, null, { backgroundGraceMs: 10_000 });
  const agent = x.connect(); await until(x.relay.connected);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const jobs = Array.from({ length: 8 }, () => fetch(x.url + "/api/chat", { method: "POST", headers,
    body: JSON.stringify({ model: "gemma4:12b", stream: false }), signal: controller.signal,
  }).then((r) => r.text()).catch(() => null));
  await until(() => agent.pending() === 8);
  const overflow = await fetch(x.url + "/api/chat", { method: "POST", headers, body: JSON.stringify({ model: "gemma4:12b", stream: false }) });
  assert.equal(overflow.status, 503);
  const chat = await fetch(x.url + "/api/chat", { method: "POST", headers, body });
  assert.equal(chat.status, 200);
  assert.match(await chat.text(), /local .*reply/s);
  controller.abort(); await Promise.all(jobs);
});

test("committed background responses are never restarted", async (t) => {
  const responses = [];
  const x = await setup(t, (_req, res) => {
    responses.push(res); res.writeHead(200, { "content-type": "application/json" }); res.flushHeaders();
  });
  const agent = x.connect(); await until(x.relay.connected);
  const first = await fetch(x.url + "/api/chat", { method: "POST", headers, body: JSON.stringify({ model: "gemma4:12b", stream: false }) });
  const firstBody = first.text();
  const chat = fetch(x.url + "/api/chat", { method: "POST", headers, body }).then((r) => r.text());
  await until(() => agent.pending() === 2);
  assert.equal(responses.length, 1);
  responses[0].end('{"ok":true}'); await firstBody;
  await until(() => responses.length === 2);
  responses[1].end('{"done":true}'); await chat;
  assert.equal(x.received.length, 2);
});

test("caller cancellation while extraction is preempted prevents its restart", async (t) => {
  const responses = [];
  const x = await setup(t, (_req, res) => responses.push(res));
  const agent = x.connect(); await until(x.relay.connected);
  const controller = new AbortController();
  const extraction = fetch(x.url + "/api/chat", { method: "POST", headers, signal: controller.signal,
    body: JSON.stringify({ model: "gemma4:12b", stream: false }),
  }).catch(() => null);
  await until(() => responses.length === 1);
  const chat = fetch(x.url + "/api/chat", { method: "POST", headers, body }).then((r) => r.text());
  await until(() => responses.length === 2);
  controller.abort(); await extraction;
  await until(() => agent.pending() === 1);
  responses[1].end('{"done":true}'); await chat;
  await until(() => agent.pending() === 0);
  assert.equal(responses.length, 2);
});

test("the total admission bound still applies to concurrent foreground requests", async (t) => {
  const x = await setup(t, () => {});
  const agent = x.connect(); await until(x.relay.connected);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const jobs = Array.from({ length: 12 }, () => fetch(x.url + "/api/chat", { method: "POST", headers, body,
    signal: controller.signal }).catch(() => null));
  await until(() => agent.pending() === 12);
  assert.equal((await fetch(x.url + "/api/chat", { method: "POST", headers, body })).status, 503);
  assert.equal(x.received.length, 1);
  controller.abort(); await Promise.all(jobs);
});

test("native model metadata reveals only the two VisionQuest model tags", async (t) => {
  const x = await setup(t, (_req, res) => res.end(JSON.stringify({ models: [
    { name: "unrelated:model" }, { name: "gemma4:12b" }, { name: "gemma4:12b-mlx" },
  ] })));
  x.connect(); await until(x.relay.connected);
  const response = await fetch(x.url + "/api/tags", { headers });
  assert.deepEqual((await response.json()).models, [{ name: "gemma4:12b" }, { name: "gemma4:12b-mlx" }]);
});

test("preemption never extends the original caller deadline", async (t) => {
  const x = await setup(t, (_req, res) => {
    if (x.received.length === 2) { res.writeHead(200); res.end('{}'); }
  }, { requestTimeout: 180, backgroundGraceMs: 10 });
  x.connect(); await until(x.relay.connected);
  const background = fetch(x.url + '/api/chat', { method: 'POST', headers,
    body: JSON.stringify({ model: 'gemma4:12b', stream: false }) });
  await until(() => x.received.length === 1);
  await new Promise((r) => setTimeout(r, 90));
  const chat = await fetch(x.url + '/api/chat', { method: 'POST', headers, body });
  assert.equal(chat.status, 200); await chat.text();
  assert.equal((await background).status, 504);
  await until(() => x.received.length === 3);
  // The restarted computation is cancelled by the original adapter deadline.
  assert.equal(x.relay.connected(), true);
});


test("case-variant stream controls cannot bypass background classification", async (t) => {
  const x = await setup(t); x.connect(); await until(x.relay.connected);
  for (const streamKey of ["Stream", "STREAM", "sTrEaM"]) {
    for (const canonical of [{}, { stream: true }, { stream: false }]) {
      const input = { model: "gemma4:12b", ...canonical, [streamKey]: false };
      assert.equal(allowedRequest("POST", "/api/chat", JSON.stringify(input)), false);
      assert.equal((await fetch(x.url + "/api/chat", { method: "POST", headers,
        body: JSON.stringify(input) })).status, 400);
    }
  }
  assert.equal(x.received.length, 0);
});
