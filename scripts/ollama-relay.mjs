#!/usr/bin/env node
/**
 * Ollama Keepalive Relay
 *
 * Sits between cloudflared and Ollama to defeat Cloudflare's 120-second
 * proxy read timeout. For streaming requests, immediately returns HTTP 200
 * and sends heartbeat pings every 25s while Ollama evaluates the prompt,
 * then pipes Ollama's actual tokens through transparently.
 *
 * Because the 200 is already sent, an upstream failure is reported as one
 * SSE line, `data: {"error":"Ollama returned NNN: <cause>"}`. The cause is
 * read from Ollama's error body. Keep the `Ollama returned NNN` prefix:
 * `isRetryableStartupError` in src/lib/ai/ollama-provider.ts matches it.
 *
 * Usage:
 *   node scripts/ollama-relay.mjs
 *
 * Then point cloudflared config at http://localhost:11435
 *
 * Tests: npm run test:relay
 */

import http from "node:http";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const RELAY_PORT = parseInt(process.env.RELAY_PORT || "11435", 10);
const HEARTBEAT_INTERVAL_MS = 25_000;

// An error body is read only far enough to name the cause. Ollama's own
// errors are a few hundred bytes; a proxy's HTML page needs no more.
const ERROR_BODY_MAX_BYTES = 2048;
const ERROR_BODY_TIMEOUT_MS = 1_500;
const ERROR_MESSAGE_MAX_CHARS = 300;
const ERROR_UNWRAP_MAX_DEPTH = 4;

const ollamaUrl = new URL(OLLAMA_HOST);

/** Reads at most ERROR_BODY_MAX_BYTES of a response, never waiting past the timeout. Never rejects. */
function readCappedBody(res) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!res.complete) res.destroy();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(finish, ERROR_BODY_TIMEOUT_MS);
    res.on("data", (chunk) => {
      if (done) return;
      const kept = chunk.subarray(0, ERROR_BODY_MAX_BYTES - size);
      chunks.push(kept);
      size += kept.length;
      if (size >= ERROR_BODY_MAX_BYTES) finish();
    });
    res.once("end", finish);
    res.once("error", finish);
    res.once("close", finish);
  });
}

function oneLine(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, ERROR_MESSAGE_MAX_CHARS);
}

/**
 * Ollama 0.40.3 nests llama.cpp's error object as a JSON string inside its
 * own envelope: {"error":"{\"error\":{\"message\":\"request (4246 tokens)
 * exceeds ...\"}}"}. Unwrap to the innermost message, or keep the outer
 * string when it is not JSON.
 */
function messageFromValue(value, depth) {
  if (depth > ERROR_UNWRAP_MAX_DEPTH) return null;
  if (typeof value === "string") {
    return messageFromJson(value, depth + 1) ?? (oneLine(value) || null);
  }
  if (value && typeof value === "object") {
    return messageFromValue(value.message ?? value.error, depth + 1);
  }
  return null;
}

function messageFromJson(text, depth) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  return messageFromValue(parsed.error ?? parsed.message, depth);
}

function upstreamErrorText(status, body) {
  const message = messageFromJson(body, 0) ?? (oneLine(body) || null);
  return message ? `Ollama returned ${status}: ${message}` : `Ollama returned ${status}`;
}

function isStreamingRequest(body) {
  try {
    return JSON.parse(body).stream === true;
  } catch {
    return false;
  }
}

function forwardHeaders(clientReq) {
  const headers = { ...clientReq.headers };
  headers.host = `${ollamaUrl.hostname}:${ollamaUrl.port || 11434}`;
  // Strip Cloudflare headers before forwarding to Ollama
  for (const key of Object.keys(headers)) {
    if (key.startsWith("cf-") || key === "cdn-loop") {
      delete headers[key];
    }
  }
  return headers;
}

function handleNonStreaming(clientReq, clientRes, requestBody) {
  const upstreamReq = http.request(
    {
      hostname: ollamaUrl.hostname,
      port: ollamaUrl.port || 11434,
      path: clientReq.url,
      method: clientReq.method,
      headers: forwardHeaders(clientReq),
    },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    },
  );

  upstreamReq.setTimeout(300_000, () => {
    console.error("[relay] non-streaming upstream timeout");
    upstreamReq.destroy();
  });

  upstreamReq.on("error", (err) => {
    console.error("[relay] non-streaming error:", err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "Content-Type": "application/json" });
    }
    clientRes.end(JSON.stringify({ error: `Relay: ${err.message}` }));
  });

  if (requestBody) upstreamReq.write(requestBody);
  upstreamReq.end();
}

function handleStreaming(clientReq, clientRes, requestBody) {
  // KEY: Send headers IMMEDIATELY — before Ollama responds.
  // This defeats Cloudflare's 120s first-byte timeout.
  clientRes.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Transfer-Encoding": "chunked",
  });

  // Start heartbeats immediately
  let finished = false;
  const heartbeat = setInterval(() => {
    if (!finished) {
      try {
        clientRes.write(": heartbeat\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Send first heartbeat right away
  clientRes.write(": heartbeat\n\n");

  // Now connect to Ollama (this may take 30-120s for prompt eval)
  let upstreamReq;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    clearInterval(heartbeat);
  };
  const abortUpstream = (reason) => {
    cleanup();
    if (reason) {
      console.error(`[relay] streaming closed: ${reason}`);
    }
    upstreamReq?.destroy();
  };

  clientRes.on("close", () => abortUpstream("client response closed"));

  upstreamReq = http.request(
    {
      hostname: ollamaUrl.hostname,
      port: ollamaUrl.port || 11434,
      path: clientReq.url,
      method: clientReq.method,
      headers: forwardHeaders(clientReq),
    },
    (upstreamRes) => {
      if (upstreamRes.statusCode !== 200) {
        cleanup();
        const status = upstreamRes.statusCode;
        readCappedBody(upstreamRes).then((body) => {
          const error = upstreamErrorText(status, body);
          console.error(`[relay] ${error}`);
          if (clientRes.writableEnded || clientRes.destroyed) return;
          clientRes.write(`data: ${JSON.stringify({ error })}\n\n`);
          clientRes.end();
        });
        return;
      }

      // Pipe Ollama's streaming tokens through to the client
      upstreamRes.on("data", (chunk) => {
        try {
          clientRes.write(chunk);
        } catch {
          abortUpstream("client write failed");
        }
      });

      upstreamRes.on("end", () => {
        cleanup();
        clientRes.end();
      });

      upstreamRes.on("error", (err) => {
        abortUpstream(`upstream stream error: ${err.message}`);
        console.error("[relay] upstream stream error:", err.message);
        clientRes.end();
      });
    },
  );

  upstreamReq.setTimeout(300_000, () => {
    console.error("[relay] streaming upstream timeout (5min)");
    abortUpstream("upstream timeout");
    clientRes.end();
  });

  upstreamReq.on("error", (err) => {
    cleanup();
    console.error("[relay] streaming connection error:", err.message);
    try {
      clientRes.write(
        `data: ${JSON.stringify({ error: `Relay: ${err.message}` })}\n\n`,
      );
    } catch { /* ignore */ }
    clientRes.end();
  });

  if (requestBody) upstreamReq.write(requestBody);
  upstreamReq.end();
}

const server = http.createServer((clientReq, clientRes) => {
  const chunks = [];
  clientReq.on("data", (chunk) => chunks.push(chunk));
  clientReq.on("end", () => {
    const requestBody = Buffer.concat(chunks).toString();
    const streaming = isStreamingRequest(requestBody);

    if (streaming) {
      handleStreaming(clientReq, clientRes, requestBody);
    } else {
      handleNonStreaming(clientReq, clientRes, requestBody);
    }
  });
});

server.listen(RELAY_PORT, () => {
  console.log(`[relay] Ollama keepalive relay listening on port ${RELAY_PORT}`);
  console.log(`[relay] Forwarding to ${OLLAMA_HOST}`);
  console.log(`[relay] Heartbeat every ${HEARTBEAT_INTERVAL_MS / 1000}s`);
  console.log(`[relay] Streaming requests get immediate 200 + heartbeats`);
});
