#!/usr/bin/env node
/**
 * Ollama Keepalive Relay
 *
 * Sits between cloudflared and Ollama to defeat Cloudflare's 120-second
 * proxy read timeout. For streaming requests, immediately returns HTTP 200
 * and sends heartbeat pings every 25s while Ollama evaluates the prompt,
 * then pipes Ollama's actual tokens through transparently.
 *
 * Usage:
 *   node scripts/ollama-relay.mjs
 *
 * Then point cloudflared config at http://localhost:11435
 */

import http from "node:http";

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const RELAY_PORT = parseInt(process.env.RELAY_PORT || "11435", 10);
const HEARTBEAT_INTERVAL_MS = 25_000;

const ollamaUrl = new URL(OLLAMA_HOST);

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
  const upstreamReq = http.request(
    {
      hostname: ollamaUrl.hostname,
      port: ollamaUrl.port || 11434,
      path: clientReq.url,
      method: clientReq.method,
      headers: forwardHeaders(clientReq),
    },
    (upstreamRes) => {
      if (upstreamRes.statusCode !== 200) {
        clearInterval(heartbeat);
        finished = true;
        const errMsg = `data: ${JSON.stringify({ error: `Ollama returned ${upstreamRes.statusCode}` })}\n\n`;
        clientRes.write(errMsg);
        clientRes.end();
        return;
      }

      // Pipe Ollama's streaming tokens through to the client
      upstreamRes.on("data", (chunk) => {
        try {
          clientRes.write(chunk);
        } catch {
          clearInterval(heartbeat);
          finished = true;
        }
      });

      upstreamRes.on("end", () => {
        clearInterval(heartbeat);
        finished = true;
        clientRes.end();
      });

      upstreamRes.on("error", (err) => {
        clearInterval(heartbeat);
        finished = true;
        console.error("[relay] upstream stream error:", err.message);
        clientRes.end();
      });
    },
  );

  upstreamReq.setTimeout(300_000, () => {
    console.error("[relay] streaming upstream timeout (5min)");
    clearInterval(heartbeat);
    finished = true;
    upstreamReq.destroy();
    clientRes.end();
  });

  upstreamReq.on("error", (err) => {
    clearInterval(heartbeat);
    finished = true;
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
