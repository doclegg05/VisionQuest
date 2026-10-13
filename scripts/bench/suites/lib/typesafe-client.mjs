/**
 * Minimal client for TypeSafe's Jev classifier, called through OpenRouter's
 * System One endpoint (POST https://openrouter.ai/api/v1/systemone), which
 * implements TypeSafe's own request and response shapes.
 *
 * BENCHMARK USE ONLY, SYNTHETIC DATA ONLY. Real student data must never reach
 * OpenRouter (docs/runbooks/openrouter-test-bench.md).
 *
 * API contract, from https://docs.typesafe.ai/api.md and
 * https://openrouter.ai/docs/guides/community/typesafe-sdk.md (October 2026):
 *   POST {base}/v1/systemone, Authorization: Bearer <key>
 *   body     { model, state, questions: { <id>: { type: "choice", instructions, criteria } } }
 *   response { model, provider, answers: { <id>: { type, choice, probabilities, confidence } }, usage }
 *   429 and 529 are retryable; 401 and 422 are not.
 */

export const SYSTEMONE_DEFAULT_BASE = "https://openrouter.ai/api";
export const JEV_DEFAULT_MODEL = "typesafe/jev-1.13";

const MAX_CHOICE_OPTIONS = 255;
const RETRYABLE_STATUSES = new Set([429, 529]);
const PROBABILITY_SUM_TOLERANCE = 0.01;
const ERROR_EXCERPT_CHARS = 200;
const BASE_BACKOFF_MS = 500;

export class TypeSafeError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number|null }} [options]
   */
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = "TypeSafeError";
    this.status = status;
  }
}

/**
 * A Choice question whose criteria keep the caller's option order (Jev leans
 * toward the first option, so order is something the benchmark varies).
 *
 * @param {string} instructions
 * @param {{ key: string, description: string|null }[]} options
 */
export function choiceQuestion(instructions, options) {
  if (options.length === 0 || options.length > MAX_CHOICE_OPTIONS) {
    throw new TypeSafeError(`a Choice question takes 1 to ${MAX_CHOICE_OPTIONS} options, got ${options.length}`);
  }
  const keys = options.map((option) => option.key);
  if (new Set(keys).size !== keys.length) {
    throw new TypeSafeError("Choice option keys must be unique");
  }
  return {
    type: "choice",
    instructions,
    criteria: Object.fromEntries(options.map((option) => [option.key, option.description])),
  };
}

/**
 * Validate one Choice answer against the options that were asked.
 *
 * @param {unknown} answer
 * @param {readonly string[]} optionKeys
 * @returns {{ choice: string, probabilities: Record<string, number>, confidence: number|null }}
 */
export function parseChoiceAnswer(answer, optionKeys) {
  const record = /** @type {Record<string, unknown>} */ (answer ?? {});
  const choice = record.choice;
  if (typeof choice !== "string" || !optionKeys.includes(choice)) {
    throw new TypeSafeError(`Jev chose "${String(choice)}", which is not one of the options`);
  }

  const raw = record.probabilities;
  if (!raw || typeof raw !== "object") {
    throw new TypeSafeError("Jev returned no probabilities");
  }
  const probabilities = {};
  let sum = 0;
  for (const key of optionKeys) {
    const value = /** @type {Record<string, unknown>} */ (raw)[key] ?? 0;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeSafeError(`Jev returned a non-numeric probability for "${key}"`);
    }
    probabilities[key] = value;
    sum += value;
  }
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
    throw new TypeSafeError(`Jev probabilities sum to ${sum.toFixed(3)}, not 1`);
  }

  const confidence = typeof record.confidence === "number" ? record.confidence : null;
  return { choice, probabilities, confidence };
}

function scrub(text, apiKey) {
  return apiKey ? text.split(apiKey).join("[redacted:OPENROUTER_API_KEY]") : text;
}

async function readJson(response, apiKey) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeSafeError(
      `TypeSafe returned non-JSON (${response.status}): ${scrub(text.slice(0, ERROR_EXCERPT_CHARS), apiKey)}`,
      { status: response.status },
    );
  }
}

async function postOnce({ url, apiKey, body, fetchImpl, timeoutMs }) {
  const startedAt = performance.now();
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    throw new TypeSafeError(`TypeSafe request failed (${reason})`);
  }
  return { response, latencyMs: Math.round(performance.now() - startedAt) };
}

/**
 * One System One call, retrying only the statuses TypeSafe documents as
 * retryable. `latencyMs` is the successful attempt's round trip.
 *
 * @param {{
 *   apiKey: string, model: string, state: unknown, questions: Record<string, unknown>,
 *   baseUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number, maxRetries?: number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} request
 */
export async function callSystemOne({
  apiKey,
  model,
  state,
  questions,
  baseUrl = SYSTEMONE_DEFAULT_BASE,
  fetchImpl = fetch,
  timeoutMs = 15_000,
  maxRetries = 3,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (process.env.NEXT_RUNTIME?.trim() || process.env.RENDER?.trim()) {
    throw new TypeSafeError("Jev through OpenRouter is eval-only and refuses to run inside the app server.");
  }
  if (!apiKey) throw new TypeSafeError("OPENROUTER_API_KEY is not set");

  const url = `${baseUrl.replace(/\/+$/, "")}/v1/systemone`;
  const body = JSON.stringify({ model, state, questions });

  for (let attempt = 0; ; attempt += 1) {
    const { response, latencyMs } = await postOnce({ url, apiKey, body, fetchImpl, timeoutMs });
    if (response.ok) {
      const json = await readJson(response, apiKey);
      return {
        model: json.model ?? model,
        answers: json.answers ?? {},
        usage: json.usage ?? null,
        upstreamProvider: typeof json.provider === "string" ? json.provider : null,
        latencyMs,
        retries: attempt,
      };
    }
    if (RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
      await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      continue;
    }
    const excerpt = scrub((await response.text()).slice(0, ERROR_EXCERPT_CHARS), apiKey);
    throw new TypeSafeError(`TypeSafe returned ${response.status}: ${excerpt}`, { status: response.status });
  }
}
