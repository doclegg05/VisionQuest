import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import { z } from "zod";
import { createInferenceQueue } from "./inference-queue.mjs";
import { AGENT_PATH, MAX_BODY, MAX_PENDING, MAX_BACKGROUND_PENDING, LOCAL_MODELS, isBackgroundRequest, REQUEST_TIMEOUT, allowedRequest, parseFrame, requestSchema, sendFrame, validToken } from "./protocol.mjs";

export function connectMacAgent({ relayUrl, agentToken, upstreamUrl = "http://127.0.0.1:11434", reconnectMs = 1000, allowLoopbackWs = false, backgroundGraceMs = 10_000, onState = () => {} }) {
  const endpoint = new URL(relayUrl);
  const upstream = new URL(upstreamUrl);
  if (!validToken(agentToken) || endpoint.pathname !== AGENT_PATH || endpoint.search || endpoint.hash || endpoint.username || endpoint.password ||
      (endpoint.protocol !== "wss:" && !(allowLoopbackWs && endpoint.protocol === "ws:" && endpoint.hostname === "127.0.0.1"))) {
    throw new Error("An authenticated secure VisionQuest relay URL is required");
  }
  if (upstream.protocol !== "http:" || upstream.hostname !== "127.0.0.1" || upstream.pathname !== "/" || upstream.search || upstream.hash || upstream.username || upstream.password) {
    throw new Error("The model bridge must be on Mac loopback");
  }
  let stopped = false;
  let socket;
  let reconnect;
  let heartbeat;
  let attempts = 0;
  const active = new Map();
  // Cancellation must reach native Ollama, not a buffering HTTP bridge.
  const enqueueInference = createInferenceQueue({ backgroundGraceMs, preemptBackground: upstream.port === "11434" || allowLoopbackWs });
  const abortAll = () => { for (const { controller } of active.values()) controller.abort(); active.clear(); };
  const run = () => {
    if (stopped) return;
    const ws = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${agentToken}` }, maxPayload: MAX_BODY * 6 + 1024, perMessageDeflate: false, handshakeTimeout: 15_000, followRedirects: false });
    socket = ws;
    let lastPing = Date.now();
    ws.on("open", () => {
      attempts = 0;
      onState("connected");
      heartbeat = setInterval(() => { if (Date.now() - lastPing > 60_000) ws.terminate(); }, 15_000);
      heartbeat.unref();
    });
    ws.on("ping", () => { lastPing = Date.now(); });
    ws.on("error", () => { /* close handles reconnect; never log headers or payloads */ });
    ws.on("close", () => {
      clearInterval(heartbeat);
      abortAll();
      onState("disconnected");
      if (!stopped) {
        const delay = Math.min(30_000, reconnectMs * 2 ** Math.min(attempts++, 5));
        reconnect = setTimeout(run, delay + Math.floor(Math.random() * 250));
      }
    });
    ws.on("message", async (raw, binary) => {
      const frame = binary ? null : parseFrame(raw, requestSchema);
      if (!frame) return ws.close(1008, "Invalid relay frame");
      if (frame.type === "cancel") { active.get(frame.id)?.controller.abort(); return; }
      if (active.has(frame.id)) return ws.close(1008, "Duplicate request");
      if (active.size >= MAX_PENDING || !allowedRequest(frame.method, frame.path, frame.body) || Buffer.byteLength(frame.body) > MAX_BODY) {
        try { sendFrame(ws, { type: "error", id: frame.id }); } catch { ws.terminate(); }
        return;
      }
      const background = isBackgroundRequest(frame.method, frame.path, frame.body);
      if (background && [...active.values()].filter((item) => item.background).length >= MAX_BACKGROUND_PENDING) {
        try { sendFrame(ws, { type: "error", id: frame.id }); } catch { ws.terminate(); }
        return;
      }
      const controller = new AbortController();
      active.set(frame.id, { controller, background });
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      try {
        const forward = async ({ signal = controller.signal, commit = () => {} } = {}) => {
          let response = await fetch(new URL(frame.path, upstream), {
            method: frame.method,
            body: frame.method === "POST" ? frame.body : undefined,
            headers: { "content-type": "application/json" },
            signal,
            redirect: "error",
          });
          signal.throwIfAborted();
          if (frame.method === "GET" && frame.path === "/api/tags" && response.ok) {
            const tags = await response.json();
            response = new Response(JSON.stringify({ models: (tags.models ?? []).filter((entry) => LOCAL_MODELS.includes(entry.name)) }), { headers: { "content-type": "application/json" } });
          }
          commit();
          const rawType = response.headers.get("content-type")?.split(";")[0];
          const contentType = ["application/json", "application/x-ndjson", "text/event-stream"].includes(rawType) ? rawType : "application/json";
          sendFrame(ws, { type: "start", id: frame.id, status: response.status, contentType });
          if (response.body) {
            for await (const value of response.body) {
              const bytes = Buffer.from(value);
              for (let offset = 0; offset < bytes.length; offset += 48 * 1024) {
                sendFrame(ws, { type: "data", id: frame.id, data: bytes.subarray(offset, offset + 48 * 1024).toString("base64") });
              }
            }
          }
          sendFrame(ws, { type: "end", id: frame.id });
        };
        if (frame.method === "POST" && ["/api/chat", "/api/generate"].includes(frame.path)) {
          // Sage streams interactive replies; structured extraction uses
          // stream:false. Keep health/model metadata independent of this queue.
          const interactive = !background;
          await enqueueInference(forward, { signal: controller.signal, interactive });
        } else {
          await forward();
        }
      } catch {
        controller.abort();
        try { sendFrame(ws, { type: "error", id: frame.id }); } catch { ws.terminate(); }
      } finally {
        clearTimeout(timer);
        active.delete(frame.id);
      }
    });
  };
  run();
  return {
    pending: () => active.size,
    stop() { stopped = true; clearTimeout(reconnect); clearInterval(heartbeat); abortAll(); socket?.terminate(); },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
  const configPath = process.argv[2];
  if (!configPath) throw new Error("Pass the private agent configuration file path");
  const stat = statSync(configPath);
  if ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) throw new Error("Agent configuration must be owned by this user with mode 0600");
  const config = z.object({ relayUrl: z.string(), agentToken: z.string(), upstreamUrl: z.string().optional() }).strict().parse(JSON.parse(readFileSync(configPath, "utf8")));
  const agent = connectMacAgent({ ...config, onState: (state) => console.log(`VisionQuest Mac connection ${state}`) });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { agent.stop(); process.exit(0); });
  } catch {
    // Parser/URL exceptions may include config fragments; never print the cause.
    console.error("VisionQuest Mac agent could not start; check private configuration and permissions.");
    process.exitCode = 1;
  }
}
