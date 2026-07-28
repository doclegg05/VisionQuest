const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export function normalizeBenchmarkRequest(config, testCase) {
  if (!config?.systemPrompt || !testCase?.prompt || !testCase?.context) {
    throw new Error("Benchmark request requires a system prompt, case prompt, and synthetic context.");
  }
  return Object.freeze({
    caseId: testCase.id,
    systemPrompt: config.systemPrompt,
    inputText: `Context:\n${testCase.context}\n\nRequest:\n${testCase.prompt}`,
    generation: Object.freeze({
      maxOutputTokens: config.generation.maxOutputTokens,
    }),
  });
}

export function buildGeminiHttpRequest(canonical, options) {
  const model = options.model;
  const baseUrl = trimTrailingSlash(options.baseUrl || DEFAULT_GEMINI_BASE_URL);
  const modelPath = encodeURIComponent(model.replace(/^models\//, ""));
  return {
    url: `${baseUrl}/models/${modelPath}:streamGenerateContent?alt=sse`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": options.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: canonical.systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: canonical.inputText }],
          },
        ],
        generationConfig: {
          maxOutputTokens: canonical.generation.maxOutputTokens,
        },
      }),
    },
  };
}

export function buildOpenAiHttpRequest(canonical, options) {
  const baseUrl = trimTrailingSlash(options.baseUrl || DEFAULT_OPENAI_BASE_URL);
  return {
    url: `${baseUrl}/responses`,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        instructions: canonical.systemPrompt,
        input: canonical.inputText,
        max_output_tokens: canonical.generation.maxOutputTokens,
        stream: true,
        store: false,
      }),
    },
  };
}

async function* iterateSse(response) {
  if (!response.body) throw new Error("Provider returned no streaming response body.");
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
      buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
      const event = parseSseBlock(block);
      if (event) yield event;
      boundary = buffer.search(/\r?\n\r?\n/);
    }
  }

  buffer += decoder.decode();
  const finalEvent = parseSseBlock(buffer);
  if (finalEvent) yield finalEvent;
}

function parseSseBlock(block) {
  if (!block.trim()) return null;
  let eventName = "message";
  const dataLines = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  const data = dataLines.join("\n");
  if (!data || data === "[DONE]") return null;
  return { event: eventName, data };
}

async function ensureOk(response, provider) {
  if (response.ok) return;
  const requestId = response.headers.get("x-request-id") || response.headers.get("x-goog-request-id");
  throw new Error(
    `${provider} request failed with HTTP ${response.status}${requestId ? ` (request ${requestId})` : ""}`,
  );
}

function nowMilliseconds() {
  return performance.now();
}

async function runGemini(canonical, options) {
  const request = buildGeminiHttpRequest(canonical, options);
  const now = options.now ?? nowMilliseconds;
  const started = now();
  const response = await (options.fetchImpl ?? fetch)(request.url, request.init);
  await ensureOk(response, "Gemini");

  let firstTokenAt = null;
  let output = "";
  let usage = null;
  let responseId = null;
  let modelVersion = null;

  for await (const event of iterateSse(response)) {
    const payload = JSON.parse(event.data);
    const text = (payload.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");
    if (text) {
      if (firstTokenAt === null) firstTokenAt = now();
      output += text;
    }
    if (payload.usageMetadata) {
      const raw = payload.usageMetadata;
      usage = {
        inputTokens: raw.promptTokenCount ?? 0,
        outputTokens: (raw.candidatesTokenCount ?? 0) + (raw.thoughtsTokenCount ?? 0),
        cachedInputTokens: raw.cachedContentTokenCount ?? 0,
        totalTokens: raw.totalTokenCount ?? 0,
        raw,
      };
    }
    responseId = payload.responseId ?? responseId;
    modelVersion = payload.modelVersion ?? modelVersion;
  }

  const ended = now();
  return {
    output,
    firstTokenMs: firstTokenAt === null ? null : firstTokenAt - started,
    durationMs: ended - started,
    usage,
    providerResponseId: responseId,
    providerModelVersion: modelVersion,
  };
}

async function runOpenAi(canonical, options) {
  const request = buildOpenAiHttpRequest(canonical, options);
  const now = options.now ?? nowMilliseconds;
  const started = now();
  const response = await (options.fetchImpl ?? fetch)(request.url, request.init);
  await ensureOk(response, "OpenAI");

  let firstTokenAt = null;
  let output = "";
  let usage = null;
  let responseId = null;

  for await (const event of iterateSse(response)) {
    const payload = JSON.parse(event.data);
    const eventType = payload.type ?? event.event;
    if (eventType === "response.output_text.delta" && payload.delta) {
      if (firstTokenAt === null) firstTokenAt = now();
      output += payload.delta;
    }
    if (eventType === "response.completed") {
      const completed = payload.response ?? payload;
      const raw = completed.usage;
      if (raw) {
        usage = {
          inputTokens: raw.input_tokens ?? 0,
          outputTokens: raw.output_tokens ?? 0,
          cachedInputTokens: raw.input_tokens_details?.cached_tokens ?? 0,
          totalTokens: (raw.input_tokens ?? 0) + (raw.output_tokens ?? 0),
          raw,
        };
      }
      responseId = completed.id ?? responseId;
    }
    if (eventType === "error" || eventType === "response.failed") {
      throw new Error("OpenAI stream reported a failed response.");
    }
  }

  const ended = now();
  return {
    output,
    firstTokenMs: firstTokenAt === null ? null : firstTokenAt - started,
    durationMs: ended - started,
    usage,
    providerResponseId: responseId,
    providerModelVersion: options.model,
  };
}

export async function runProviderRequest(provider, canonical, options) {
  if (provider === "gemini") return runGemini(canonical, options);
  if (provider === "openai") return runOpenAi(canonical, options);
  throw new Error(`Unsupported benchmark provider "${provider}"`);
}

export const PROVIDER_DEFAULTS = Object.freeze({
  gemini: {
    model: "gemini-3.1-flash-lite",
    baseUrl: DEFAULT_GEMINI_BASE_URL,
  },
  openai: {
    model: "gpt-5-mini",
    baseUrl: DEFAULT_OPENAI_BASE_URL,
  },
});
