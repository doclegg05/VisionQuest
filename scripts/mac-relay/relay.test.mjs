import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
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
  const next = await server((req, res) => { res.writeHead(200, { "x-test-proxy": "yes" }); res.end(req.headers.host + req.url); });
  const relay = await startRelay({ agentToken, appToken, publicPort: 0, publicHost: "127.0.0.1", localPort: 0, nextPort: next.address().port, ...options });
  const url = `http://127.0.0.1:${relay.local.address().port}`;
  const publicUrl = `http://127.0.0.1:${relay.front.address().port}`;
  let agent;
  const connect = () => {
    agent = connectMacAgent({ relayUrl: publicUrl.replace("http:", "ws:") + AGENT_PATH, agentToken, upstreamUrl: `http://127.0.0.1:${upstream.address().port}`, allowLoopbackWs: true });
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
