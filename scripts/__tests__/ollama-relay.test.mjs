// The relay answers every streaming request with an immediate 200 and
// heartbeats, so an upstream failure can reach the app only as an SSE
// `data: {"error": ...}` line. These tests start the real relay against a
// fake Ollama, both on random ports, and read that line back.
//
// Run: npm run test:relay
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const RELAY_PATH = fileURLToPath(new URL("../ollama-relay.mjs", import.meta.url));

const OVERSIZE_MESSAGE =
  "request (4246 tokens) exceeds the available context size (2048 tokens), try increasing it";

// Ollama 0.40.3's answer to an oversize prompt: the llama.cpp error object,
// serialized as a string inside Ollama's own {"error": ...} envelope.
const OVERSIZE_PROMPT_BODY = JSON.stringify({
  error: JSON.stringify({
    error: {
      code: 400,
      message: OVERSIZE_MESSAGE,
      type: "exceed_context_size_error",
      n_prompt_tokens: 4246,
      n_ctx: 2048,
    },
  }),
});

// Each path is one upstream behavior; the relay forwards the client's path.
const SCENARIOS = {
  "/oversize-400": (res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(OVERSIZE_PROMPT_BODY);
  },
  "/plain-error-404": (res) => {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "model 'gemma4:e4b' not found" }));
  },
  "/proxy-503": (res) => {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("no healthy\n  upstream\n");
  },
  "/empty-500": (res) => {
    res.writeHead(500);
    res.end();
  },
  "/huge-500": (res) => {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("x".repeat(64 * 1024));
  },
  "/stalled-502": (res) => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.write("partial cause");
  },
  "/ok-200": (res) => {
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.end('{"message":{"content":"hi"},"done":true}\n');
  },
};

let upstream;
let relay;
let relayPort;
let relayOutput = "";

async function freePort() {
  const probe = http.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  probe.close();
  await once(probe, "close");
  return port;
}

function waitForListening(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`relay did not start:\n${relayOutput}`)), 10_000);
    const onData = (chunk) => {
      relayOutput += chunk;
      if (relayOutput.includes("listening on port")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => { relayOutput += chunk; });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`relay exited with ${code}:\n${relayOutput}`));
    });
  });
}

function postStream(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: relayPort,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, text }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify({ model: "test", stream: true, messages: [] }));
  });
}

function relayError(text) {
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  assert.ok(line, `no data line in relay output: ${JSON.stringify(text)}`);
  return JSON.parse(line.slice("data: ".length)).error;
}

before(async () => {
  upstream = http.createServer((req, res) => {
    req.resume();
    const scenario = SCENARIOS[req.url];
    if (scenario) return scenario(res);
    res.writeHead(418);
    return res.end();
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");

  relayPort = await freePort();
  relay = spawn(process.execPath, [RELAY_PATH], {
    env: {
      ...process.env,
      OLLAMA_HOST: `http://127.0.0.1:${upstream.address().port}`,
      RELAY_PORT: String(relayPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  relay.stdout.setEncoding("utf8");
  relay.stderr.setEncoding("utf8");
  await waitForListening(relay);
});

after(() => {
  relay?.kill();
  upstream?.closeAllConnections();
  upstream?.close();
});

test("an oversize-prompt 400 forwards the inner llama.cpp message with the token counts", async () => {
  const { status, text } = await postStream("/oversize-400");
  assert.equal(status, 200);
  assert.equal(relayError(text), `Ollama returned 400: ${OVERSIZE_MESSAGE}`);
});

test("a plain-string error envelope forwards the outer string", async () => {
  const { text } = await postStream("/plain-error-404");
  assert.equal(relayError(text), "Ollama returned 404: model 'gemma4:e4b' not found");
});

test("a 503 with a non-JSON body forwards the text on one line", async () => {
  const { text } = await postStream("/proxy-503");
  assert.equal(relayError(text), "Ollama returned 503: no healthy upstream");
});

test("an empty error body falls back to the bare status", async () => {
  const { text } = await postStream("/empty-500");
  assert.equal(relayError(text), "Ollama returned 500");
});

test("a huge error body is capped rather than forwarded whole", async () => {
  const { text } = await postStream("/huge-500");
  const error = relayError(text);
  assert.match(error, /^Ollama returned 500: x+$/);
  assert.ok(error.length <= 400, `forwarded ${error.length} chars`);
});

test("an error body that never ends is cut off by the read timeout", async () => {
  const startedAt = Date.now();
  const { text } = await postStream("/stalled-502");
  assert.equal(relayError(text), "Ollama returned 502: partial cause");
  assert.ok(Date.now() - startedAt < 5_000, "relay waited too long for the body");
});

test("a 200 stream is still piped through untouched", async () => {
  const { status, text } = await postStream("/ok-200");
  assert.equal(status, 200);
  assert.ok(text.includes('{"message":{"content":"hi"},"done":true}\n'), text);
  assert.ok(!text.includes('data: {"error"'), text);
});
