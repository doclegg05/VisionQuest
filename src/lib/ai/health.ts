import { buildLocalAiHeaders } from "./local-auth";
import type { LocalAIAuthConfig } from "./types";

export interface HealthResult {
  healthy: boolean;
  models?: string[];
  error?: string;
  apiMode?: "openai" | "native";
  chatValidated?: boolean;
  modelUsed?: string;
}

interface HealthCheckOptions {
  timeoutMs?: number;
  model?: string | null;
  authConfig?: LocalAIAuthConfig | null;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function getModelsFromTagsPayload(data: unknown): string[] {
  if (!data || typeof data !== "object" || !("models" in data)) return [];
  const { models } = data as { models?: Array<{ name?: string }> };
  return Array.isArray(models)
    ? models
        .map((m) => m.name)
        .filter((name: string | undefined): name is string => typeof name === "string")
    : [];
}

function getModelsFromOpenAIPayload(data: unknown): string[] {
  if (!data || typeof data !== "object" || !("data" in data)) return [];
  const { data: models } = data as { data?: Array<{ id?: string }> };
  return Array.isArray(models)
    ? models
        .map((m) => m.id)
        .filter((id: string | undefined): id is string => typeof id === "string")
    : [];
}

function chooseModel(
  configuredModel: string | null | undefined,
  models: string[],
): string | null {
  if (configuredModel) return configuredModel;
  return models[0] ?? null;
}

async function probeOpenAiChat(
  baseUrl: string,
  model: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  return fetchWithTimeout(`${baseUrl}/v1/chat/completions`, timeoutMs, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with OK only." }],
      stream: false,
      max_tokens: 8,
    }),
  });
}

async function probeNativeChat(
  baseUrl: string,
  model: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  return fetchWithTimeout(`${baseUrl}/api/chat`, timeoutMs, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with OK only." }],
      stream: false,
    }),
  });
}

async function validateChatPath(
  normalizedBaseUrl: string,
  apiMode: "openai" | "native",
  model: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ ok: boolean; apiMode: "openai" | "native"; error?: string }> {
  if (apiMode === "openai") {
    const openAiResponse = await probeOpenAiChat(
      normalizedBaseUrl,
      model,
      headers,
      timeoutMs,
    );
    if (openAiResponse.ok) {
      return { ok: true, apiMode: "openai" };
    }
    if (openAiResponse.status !== 404) {
      return {
        ok: false,
        apiMode: "openai",
        error: `Chat endpoint returned ${openAiResponse.status}`,
      };
    }
  }

  const nativeResponse = await probeNativeChat(
    normalizedBaseUrl,
    model,
    headers,
    timeoutMs,
  );
  if (!nativeResponse.ok) {
    return {
      ok: false,
      apiMode: "native",
      error: `Chat endpoint returned ${nativeResponse.status}`,
    };
  }

  return { ok: true, apiMode: "native" };
}

export async function checkOllamaHealth(
  baseUrl: string,
  timeoutMsOrOptions: number | HealthCheckOptions = 2000,
  options?: HealthCheckOptions,
): Promise<HealthResult> {
  const derivedOptions =
    typeof timeoutMsOrOptions === "number"
      ? { timeoutMs: timeoutMsOrOptions, ...options }
      : timeoutMsOrOptions;
  const timeoutMs = derivedOptions.timeoutMs ?? 2000;
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  let headers: Record<string, string>;
  try {
    headers = buildLocalAiHeaders(derivedOptions.authConfig);
  } catch (err) {
    return {
      healthy: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const tagsResponse = await fetchWithTimeout(
      `${normalizedBaseUrl}/api/tags`,
      timeoutMs,
      { headers },
    );

    let models: string[] = [];
    let apiMode: "openai" | "native" = "native";

    if (tagsResponse.ok) {
      models = getModelsFromTagsPayload(await tagsResponse.json());

      const openAICompatibility = await fetchWithTimeout(
        `${normalizedBaseUrl}/v1/models`,
        timeoutMs,
        { headers },
      ).catch(() => null);

      if (openAICompatibility?.ok) {
        const openAiModels = getModelsFromOpenAIPayload(
          await openAICompatibility.json(),
        );
        if (openAiModels.length > 0) {
          models = Array.from(new Set([...models, ...openAiModels]));
        }
        apiMode = "openai";
      }
    } else {
      const openAIResponse = await fetchWithTimeout(
        `${normalizedBaseUrl}/v1/models`,
        timeoutMs,
        { headers },
      );

      if (!openAIResponse.ok) {
        return { healthy: false, error: `Server returned ${tagsResponse.status}` };
      }

      models = getModelsFromOpenAIPayload(await openAIResponse.json());
      apiMode = "openai";
    }

    const modelToUse = chooseModel(derivedOptions.model, models);
    if (!modelToUse) {
      return {
        healthy: false,
        error:
          "No local AI model is configured or loaded. Pull a model first or set a model name in Program Setup > AI Provider.",
      };
    }

    const chatValidation = await validateChatPath(
      normalizedBaseUrl,
      apiMode,
      modelToUse,
      headers,
      timeoutMs,
    );

    if (!chatValidation.ok) {
      return {
        healthy: false,
        models,
        apiMode: chatValidation.apiMode,
        modelUsed: modelToUse,
        error: chatValidation.error,
      };
    }

    return {
      healthy: true,
      models,
      apiMode: chatValidation.apiMode,
      chatValidated: true,
      modelUsed: modelToUse,
    };
  } catch (err) {
    return {
      healthy: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
