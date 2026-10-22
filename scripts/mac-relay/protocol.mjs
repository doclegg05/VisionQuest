import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const AGENT_PATH = "/__visionquest/local-ai/agent";
export const MODEL = "gemma4:12b";
export const LOCAL_MODELS = [MODEL, "gemma4:12b-mlx"];
export const MAX_BODY = 2 * 1024 * 1024;
export const MAX_RESPONSE = 16 * 1024 * 1024;
export const MAX_BUFFER = 4 * 1024 * 1024;
export const MAX_PENDING = 12;
export const MAX_BACKGROUND_PENDING = 8;
export const REQUEST_TIMEOUT = 180_000;
export const idSchema = z.string().uuid();
const base64 = z.string().max(100_000).regex(/^[A-Za-z0-9+/]*={0,2}$/);
export const responseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), id: idSchema, status: z.number().int().min(200).max(599), contentType: z.enum(["application/json", "application/x-ndjson", "text/event-stream"]) }).strict(),
  z.object({ type: z.literal("data"), id: idSchema, data: base64 }).strict(),
  z.object({ type: z.literal("end"), id: idSchema }).strict(),
  z.object({ type: z.literal("error"), id: idSchema }).strict(),
]);
export const requestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("request"), id: idSchema, method: z.enum(["GET", "POST"]), path: z.string().max(40), body: z.string().max(MAX_BODY) }).strict(),
  z.object({ type: z.literal("cancel"), id: idSchema }).strict(),
]);
const inferenceSchema = z.object({ model: z.enum(LOCAL_MODELS), options: z.object({
  num_ctx: z.number().int().min(1024).max(32768).optional(),
  num_predict: z.number().int().min(1).max(8192).optional(),
}).passthrough().optional() }).passthrough();

export function allowedRequest(method, path, body) {
  if (method === "GET") return ["/health", "/api/tags", "/api/version"].includes(path) && !body;
  if (method !== "POST" || !["/api/chat", "/api/generate", "/api/show"].includes(path)) return false;
  try {
    const parsed = JSON.parse(body);
    // Go folds ASCII and Unicode field aliases. Accept only canonical API
    // field names at the top level; message/tool payloads retain Unicode.
    const canonicalKeys = parsed !== null && typeof parsed === "object" &&
      Object.keys(parsed).every((key) => /^[a-z][a-z0-9_]*$/.test(key));
    return canonicalKeys && inferenceSchema.safeParse(parsed).success;
  } catch { return false; }
}

export function validToken(token) {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

export function authorized(header, token) {
  if (!validToken(token) || typeof header !== "string") return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseFrame(raw, schema) {
  try { return schema.parse(JSON.parse(raw.toString())); } catch { return null; }
}

export function sendFrame(socket, message) {
  if (socket.readyState !== 1 || socket.bufferedAmount > MAX_BUFFER) throw new Error("Relay connection unavailable");
  socket.send(JSON.stringify(message));
}

/** Metadata is never background inference. Call only after allowedRequest. */
export function isBackgroundRequest(method, path, body) {
  return method === "POST" && ["/api/chat", "/api/generate"].includes(path) && JSON.parse(body).stream === false;
}
