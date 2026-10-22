import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { AGENT_PATH, MAX_BODY, MAX_RESPONSE, MAX_BUFFER, MAX_PENDING, REQUEST_TIMEOUT, authorized, validToken, allowedRequest, parseFrame, responseSchema, sendFrame } from "./protocol.mjs";

function json(res, status, value) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

/** One Render instance, one authenticated Mac. Disconnects cancel rather than replay work. */
export async function startRelay({ agentToken, appToken, publicPort, nextPort, localPort = 11437, publicHost = "0.0.0.0", requestTimeout = REQUEST_TIMEOUT }) {
  if (!validToken(agentToken) || !validToken(appToken) || agentToken === appToken) throw new Error("Distinct relay credentials are required");
  let agent = null;
  const pending = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 100_000, perMessageDeflate: false });
  const fail = (id, status = 503) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    json(entry.res, status, { error: "Local AI connection unavailable" });
    if (agent) { try { sendFrame(agent, { type: "cancel", id }); } catch { /* connection is closing */ } }
  };
  const disconnect = (socket) => {
    if (agent !== socket) return;
    agent = null;
    for (const id of pending.keys()) fail(id);
  };
  wss.on("connection", (socket) => {
    agent = socket;
    socket.isAlive = true;
    socket.on("pong", () => { socket.isAlive = true; });
    socket.on("error", () => socket.terminate());
    socket.on("close", () => disconnect(socket));
    socket.on("message", (raw, binary) => {
      const frame = binary ? null : parseFrame(raw, responseSchema);
      if (!frame) return socket.close(1008, "Invalid relay frame");
      const entry = pending.get(frame.id);
      if (!entry) return; // Timed out/cancelled request; never attach it to another request.
      if (frame.type === "start") {
        if (entry.started) return fail(frame.id);
        entry.started = true;
        entry.res.writeHead(frame.status, { "content-type": frame.contentType, "cache-control": "no-store" });
        entry.res.flushHeaders();
      } else if (frame.type === "data") {
        if (!entry.started) return fail(frame.id);
        const data = Buffer.from(frame.data, "base64");
        entry.bytes += data.length;
        if (entry.bytes > MAX_RESPONSE) return fail(frame.id);
        entry.res.write(data);
        if (entry.res.writableLength > MAX_BUFFER) fail(frame.id);
      } else if (frame.type === "end") {
        if (!entry.started) return fail(frame.id);
        pending.delete(frame.id);
        clearTimeout(entry.timer);
        entry.res.end();
      } else fail(frame.id);
    });
  });
  const heartbeat = setInterval(() => {
    if (!agent) return;
    if (!agent.isAlive) return agent.terminate();
    agent.isAlive = false;
    agent.ping();
  }, 20_000);
  heartbeat.unref();

  const local = http.createServer(async (req, res) => {
    if (!authorized(req.headers.authorization, appToken)) return json(res, 401, { error: "Unauthorized" });
    if (req.method === "GET" && req.url === "/health") return json(res, agent ? 200 : 503, { connected: Boolean(agent) });
    if (!agent) return json(res, 503, { error: "Local AI is offline" });
    if (pending.size >= MAX_PENDING) return json(res, 503, { error: "Local AI is busy" });
    // Reserve before reading so concurrent slow uploads cannot overbook the cap.
    const id = randomUUID();
    const entry = { res, bytes: 0, started: false, timer: setTimeout(() => fail(id, 504), requestTimeout) };
    pending.set(id, entry);
    res.on("close", () => { if (pending.has(id)) fail(id); });
    let body = "";
    let size = 0;
    try {
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) { fail(id, 413); return; }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks).toString("utf8");
      if (!allowedRequest(req.method, req.url, body)) return fail(id, 400);
      if (!pending.has(id) || !agent) return;
      sendFrame(agent, { type: "request", id, method: req.method, path: req.url, body });
    } catch { fail(id); }
  });
  local.requestTimeout = requestTimeout;
  local.headersTimeout = 15_000;

  const front = http.createServer((req, res) => {
    if (req.url?.split("?")[0] === AGENT_PATH) return json(res, 404, { error: "Not found" });
    const upstream = http.request({ hostname: "127.0.0.1", port: nextPort, method: req.method, path: req.url, headers: req.headers }, (reply) => {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
    });
    upstream.on("error", () => json(res, 503, { error: "Service starting" }));
    res.on("close", () => { if (!res.writableEnded) upstream.destroy(); });
    req.on("error", () => upstream.destroy());
    req.pipe(upstream);
  });
  front.on("upgrade", (req, socket, head) => {
    if (req.url !== AGENT_PATH || req.headers.origin || !authorized(req.headers.authorization, agentToken)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    if (agent) {
      socket.end("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  const listen = (server, port, host) => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolve(); });
  });
  try {
    await listen(local, localPort, "127.0.0.1");
    await listen(front, publicPort, publicHost);
  } catch (error) { clearInterval(heartbeat); local.close(); front.close(); throw error; }
  return {
    front, local,
    connected: () => Boolean(agent),
    close: async () => {
      clearInterval(heartbeat);
      if (agent) { disconnect(agent); for (const client of wss.clients) client.terminate(); }
      for (const id of pending.keys()) fail(id);
      wss.close();
      await Promise.all([front, local].map((server) => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); })));
    },
  };
}
