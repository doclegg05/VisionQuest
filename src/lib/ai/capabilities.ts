/**
 * Model capability detection (Phase 4: capability detection + generic
 * OpenAI-compat mode). Lets an operator install ANY local model and see,
 * from the admin AI Provider panel, whether it will actually work with
 * Sage — reachability, chat, tool calling, JSON output, and embeddings —
 * without needing a code change to find out.
 *
 * NEVER throws: every probe is wrapped so a single failing capability
 * (missing embedding model, no tool support, etc.) surfaces as a warning
 * string instead of blowing up the whole /test route.
 */

import { checkOllamaHealth } from "./health";
import { buildLocalAiHeaders } from "./local-auth";
import { OllamaEmbeddingProvider } from "./ollama-embedding-provider";
import { EMBEDDING_DIMENSIONS } from "./embedding-types";
import type { LocalAIAuthConfig } from "./types";

export interface ModelCapabilities {
  reachable: boolean;
  apiMode: "openai" | "native" | null;
  chatValidated: boolean;
  supportsTools: boolean;
  supportsJsonOutput: boolean;
  contextLength: number | null;
  embedding: {
    reachable: boolean;
    model: string | null;
    dims: number | null;
    matches768: boolean;
  };
  installedModels: Array<{
    name: string;
    sizeBytes?: number;
    likelyEmbedding: boolean;
  }>;
  warnings: string[];
}

export interface DetectCapabilitiesConfig {
  url: string;
  model: string | null;
  embeddingModel: string | null;
  authConfig: LocalAIAuthConfig | null;
}

/** Default per-probe timeout. Keeps the admin UI responsive even against a slow/CPU-bound host. */
const DEFAULT_PROBE_TIMEOUT_MS = 8_000;
/** Sane bounds for SAGE_CAPABILITY_PROBE_TIMEOUT_MS — below 1s is too flaky, above 2min blocks the admin UI too long. */
const MIN_PROBE_TIMEOUT_MS = 1_000;
const MAX_PROBE_TIMEOUT_MS = 120_000;

/**
 * Resolves the per-probe timeout from SAGE_CAPABILITY_PROBE_TIMEOUT_MS.
 * Falls back to the 8s default when unset, non-numeric, or out of bounds —
 * a cold CPU-bound local model can need 15s+ to answer its first probe, so
 * operators can raise this instead of the probe misreporting as unreachable.
 */
export function resolveProbeTimeoutMs(): number {
  const raw = process.env.SAGE_CAPABILITY_PROBE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_PROBE_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_PROBE_TIMEOUT_MS;
  if (parsed < MIN_PROBE_TIMEOUT_MS || parsed > MAX_PROBE_TIMEOUT_MS) return DEFAULT_PROBE_TIMEOUT_MS;
  return parsed;
}

const EMBEDDING_NAME_HINTS = ["embed", "bge-", "gte-", "e5-"];

function looksLikeEmbeddingModel(name: string): boolean {
  const lower = name.toLowerCase();
  return EMBEDDING_NAME_HINTS.some((hint) => lower.includes(hint));
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface NativeTagsModel {
  name?: string;
  size?: number;
}

interface OpenAiModelsModel {
  id?: string;
}

/** Lists installed models via /api/tags (native) or /v1/models (openai style). */
async function listInstalledModels(
  normalizedBaseUrl: string,
  apiMode: "openai" | "native",
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ models: ModelCapabilities["installedModels"]; warning: string | null }> {
  try {
    if (apiMode === "native") {
      const res = await fetchWithTimeout(`${normalizedBaseUrl}/api/tags`, timeoutMs, {
        headers,
      });
      if (!res.ok) {
        return { models: [], warning: `Could not list installed models (/api/tags returned ${res.status}).` };
      }
      const payload = (await res.json()) as { models?: NativeTagsModel[] };
      const models = Array.isArray(payload.models) ? payload.models : [];
      return {
        models: models
          .filter((m): m is NativeTagsModel & { name: string } => typeof m.name === "string")
          .map((m) => ({
            name: m.name,
            sizeBytes: typeof m.size === "number" ? m.size : undefined,
            likelyEmbedding: looksLikeEmbeddingModel(m.name),
          })),
        warning: null,
      };
    }

    const res = await fetchWithTimeout(`${normalizedBaseUrl}/v1/models`, timeoutMs, {
      headers,
    });
    if (!res.ok) {
      return { models: [], warning: `Could not list installed models (/v1/models returned ${res.status}).` };
    }
    const payload = (await res.json()) as { data?: OpenAiModelsModel[] };
    const models = Array.isArray(payload.data) ? payload.data : [];
    return {
      models: models
        .filter((m): m is OpenAiModelsModel & { id: string } => typeof m.id === "string")
        .map((m) => ({
          name: m.id,
          likelyEmbedding: looksLikeEmbeddingModel(m.id),
        })),
      warning: null,
    };
  } catch (err) {
    return { models: [], warning: `Could not list installed models: ${errorMessage(err)}` };
  }
}

/** Cheap best-effort context-length lookup via native /api/show. Returns null on anything but a clean native hit. */
async function probeContextLength(
  normalizedBaseUrl: string,
  apiMode: "openai" | "native",
  model: string | null,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ contextLength: number | null; warning: string | null }> {
  if (apiMode !== "native" || !model) {
    return { contextLength: null, warning: null };
  }
  try {
    const res = await fetchWithTimeout(`${normalizedBaseUrl}/api/show`, timeoutMs, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    if (!res.ok) {
      return { contextLength: null, warning: null };
    }
    const payload = (await res.json()) as { model_info?: Record<string, unknown> };
    const modelInfo = payload.model_info ?? {};
    const contextKey = Object.keys(modelInfo).find((key) => key.endsWith(".context_length"));
    const raw = contextKey ? modelInfo[contextKey] : undefined;
    const contextLength = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    return { contextLength, warning: null };
  } catch {
    // Context length is a nice-to-have; never surface a warning for it.
    return { contextLength: null, warning: null };
  }
}

/** Minimal tool-declaration probe: a no-op tool the model isn't required to call. Must not error. */
async function probeToolSupport(
  normalizedBaseUrl: string,
  apiMode: "openai" | "native",
  model: string | null,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ supportsTools: boolean; warning: string | null }> {
  if (!model) {
    return { supportsTools: false, warning: "No model configured — skipped tool-calling probe." };
  }

  const toolPayload = {
    type: "function",
    function: {
      name: "noop",
      description: "No-op probe tool. Do not call it.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  };
  const messages = [{ role: "user", content: "Reply with OK only. Do not call any tools." }];

  try {
    if (apiMode === "openai") {
      const res = await fetchWithTimeout(
        `${normalizedBaseUrl}/v1/chat/completions`,
        timeoutMs,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            tools: [toolPayload],
            stream: false,
            max_tokens: 8,
          }),
        },
      );
      if (!res.ok) {
        return {
          supportsTools: false,
          warning: `Tool calling not supported (chat/completions with tools returned ${res.status}).`,
        };
      }
      return { supportsTools: true, warning: null };
    }

    const res = await fetchWithTimeout(`${normalizedBaseUrl}/api/chat`, timeoutMs, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        tools: [toolPayload],
        stream: false,
      }),
    });
    if (!res.ok) {
      return {
        supportsTools: false,
        warning: `Tool calling not supported (/api/chat with tools returned ${res.status}).`,
      };
    }
    return { supportsTools: true, warning: null };
  } catch (err) {
    return { supportsTools: false, warning: `Tool-calling probe failed: ${errorMessage(err)}` };
  }
}

/** JSON-output probe: request a structured reply and confirm it parses as JSON. */
async function probeJsonOutput(
  normalizedBaseUrl: string,
  apiMode: "openai" | "native",
  model: string | null,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ supportsJsonOutput: boolean; warning: string | null }> {
  if (!model) {
    return { supportsJsonOutput: false, warning: "No model configured — skipped JSON-output probe." };
  }

  const messages = [
    { role: "user", content: 'Reply with strict JSON only: {"ok": true}' },
  ];

  try {
    if (apiMode === "openai") {
      const res = await fetchWithTimeout(
        `${normalizedBaseUrl}/v1/chat/completions`,
        timeoutMs,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            response_format: { type: "json_object" },
            stream: false,
            max_tokens: 32,
          }),
        },
      );
      if (!res.ok) {
        return {
          supportsJsonOutput: false,
          warning: `JSON output mode not supported (chat/completions returned ${res.status}).`,
        };
      }
      const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = payload.choices?.[0]?.message?.content ?? "";
      return parseJsonProbeResult(text);
    }

    const res = await fetchWithTimeout(`${normalizedBaseUrl}/api/chat`, timeoutMs, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        format: "json",
        stream: false,
      }),
    });
    if (!res.ok) {
      return {
        supportsJsonOutput: false,
        warning: `JSON output mode not supported (/api/chat returned ${res.status}).`,
      };
    }
    const payload = (await res.json()) as { message?: { content?: string } };
    const text = payload.message?.content ?? "";
    return parseJsonProbeResult(text);
  } catch (err) {
    return { supportsJsonOutput: false, warning: `JSON-output probe failed: ${errorMessage(err)}` };
  }
}

function parseJsonProbeResult(text: string): { supportsJsonOutput: boolean; warning: string | null } {
  if (!text.trim()) {
    return { supportsJsonOutput: false, warning: "JSON-output probe returned an empty response." };
  }
  try {
    JSON.parse(text);
    return { supportsJsonOutput: true, warning: null };
  } catch {
    return {
      supportsJsonOutput: false,
      warning: "Model did not return parseable JSON when asked for JSON output.",
    };
  }
}

/** Embeds one short text with the configured embedding model and checks dimensions. */
async function probeEmbedding(
  baseUrl: string,
  embeddingModel: string | null,
  authConfig: LocalAIAuthConfig | null,
  timeoutMs: number,
): Promise<ModelCapabilities["embedding"] & { warning: string | null }> {
  if (!embeddingModel) {
    return {
      reachable: false,
      model: null,
      dims: null,
      matches768: false,
      warning: "No embedding model configured — set one in Program Setup > AI Provider.",
    };
  }

  try {
    const provider = new OllamaEmbeddingProvider(baseUrl, embeddingModel, authConfig);
    const vectors = await withTimeout(
      provider.embed(["capability probe"], { taskType: "RETRIEVAL_DOCUMENT" }),
      timeoutMs,
    );
    const dims = vectors[0]?.length ?? null;
    // OllamaEmbeddingProvider always L2-normalizes and asserts EMBEDDING_DIMENSIONS
    // before returning, so a successful call here is always a 768-dim match.
    return {
      reachable: true,
      model: embeddingModel,
      dims,
      matches768: dims === EMBEDDING_DIMENSIONS,
      warning: null,
    };
  } catch (err) {
    const message = errorMessage(err);
    // OllamaEmbeddingProvider hard-asserts dimensions instead of returning a
    // mismatched vector (see its class doc: never truncate). Parse the dims
    // back out of that specific error so a dimension mismatch still reports
    // as "reachable, wrong size" rather than "unreachable".
    const dimMismatch = message.match(/returned (\d+) dims for item \d+, expected \d+/i);
    if (dimMismatch) {
      const dims = Number.parseInt(dimMismatch[1], 10);
      return {
        reachable: true,
        model: embeddingModel,
        dims,
        matches768: false,
        warning: `Embedding model "${embeddingModel}" returned ${dims} dims, expected ${EMBEDDING_DIMENSIONS}. Use a native ${EMBEDDING_DIMENSIONS}-dim model (e.g. nomic-embed-text, embeddinggemma).`,
      };
    }

    const notPulled = /not found|404|no such model/i.test(message);
    return {
      reachable: false,
      model: embeddingModel,
      dims: null,
      matches768: false,
      warning: notPulled
        ? `${embeddingModel} not pulled — run: ollama pull ${embeddingModel}`
        : `Embedding probe failed for "${embeddingModel}": ${message}`,
    };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Probe timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

/**
 * Detects what a configured local AI endpoint + model can actually do.
 * Never throws — every failure mode becomes a warning string so the admin
 * UI can render a partial capability panel instead of erroring out.
 */
export async function detectModelCapabilities(
  cfg: DetectCapabilitiesConfig,
): Promise<ModelCapabilities> {
  const warnings: string[] = [];
  const normalizedBaseUrl = cfg.url.replace(/\/+$/, "");
  const timeoutMs = resolveProbeTimeoutMs();

  let headers: Record<string, string>;
  try {
    headers = buildLocalAiHeaders(cfg.authConfig);
  } catch (err) {
    return {
      reachable: false,
      apiMode: null,
      chatValidated: false,
      supportsTools: false,
      supportsJsonOutput: false,
      contextLength: null,
      embedding: { reachable: false, model: cfg.embeddingModel, dims: null, matches768: false },
      installedModels: [],
      warnings: [errorMessage(err)],
    };
  }

  const health = await checkOllamaHealth(cfg.url, {
    timeoutMs,
    model: cfg.model,
    authConfig: cfg.authConfig,
  });

  if (!health.healthy || !health.apiMode) {
    return {
      reachable: false,
      apiMode: health.apiMode ?? null,
      chatValidated: false,
      supportsTools: false,
      supportsJsonOutput: false,
      contextLength: null,
      embedding: { reachable: false, model: cfg.embeddingModel, dims: null, matches768: false },
      installedModels: [],
      warnings: [health.error ?? "Local AI server is unreachable."],
    };
  }

  const apiMode = health.apiMode;
  const modelUsed = health.modelUsed ?? cfg.model ?? null;

  const [installed, contextResult, toolResult, jsonResult, embeddingResult] = await Promise.all([
    listInstalledModels(normalizedBaseUrl, apiMode, headers, timeoutMs),
    probeContextLength(normalizedBaseUrl, apiMode, modelUsed, headers, timeoutMs),
    probeToolSupport(normalizedBaseUrl, apiMode, modelUsed, headers, timeoutMs),
    probeJsonOutput(normalizedBaseUrl, apiMode, modelUsed, headers, timeoutMs),
    probeEmbedding(cfg.url, cfg.embeddingModel, cfg.authConfig, timeoutMs),
  ]);

  if (installed.warning) warnings.push(installed.warning);
  if (contextResult.warning) warnings.push(contextResult.warning);
  if (toolResult.warning) warnings.push(toolResult.warning);
  if (jsonResult.warning) warnings.push(jsonResult.warning);
  if (embeddingResult.warning) warnings.push(embeddingResult.warning);

  const { warning: _embeddingWarning, ...embedding } = embeddingResult;

  return {
    reachable: true,
    apiMode,
    chatValidated: Boolean(health.chatValidated),
    supportsTools: toolResult.supportsTools,
    supportsJsonOutput: jsonResult.supportsJsonOutput,
    contextLength: contextResult.contextLength,
    embedding,
    installedModels: installed.models,
    warnings,
  };
}
