/**
 * Provider-agnostic eval bootstrap.
 *
 * Resolves a REAL AIProvider instance (GeminiProvider or OllamaProvider) from
 * CLI args / env, for use by any Sage eval script. Copies the instantiation
 * pattern already used by scripts/sage-memory-eval.mjs (dynamic import of the
 * TS provider class from a .mjs script via tsx) — no new loader invented.
 *
 * Usage:
 *   const { provider, label } = await resolveEvalProvider();
 *   const { provider, label } = await resolveEvalProvider(["--provider=ollama"]);
 *   const { provider, label } = await resolveEvalProvider(["--provider=ollama", "--model=gemma4:e4b"]);
 *
 * `--provider` selects the provider CLASS; `--model` selects the model tag
 * within it, overriding OLLAMA_MODEL / GEMINI_MODEL. This is the single
 * chokepoint every model-driving eval resolves through, so a model flag added
 * here reaches all of them — which is what makes a per-model bake-off possible
 * without mutating global configuration between arms.
 */

export async function resolveEvalProvider(argvOrEnv = process.argv.slice(2)) {
  const flag = argvOrEnv.find((arg) => arg.startsWith("--provider="));
  const requested = (flag ? flag.slice("--provider=".length) : process.env.SAGE_EVAL_PROVIDER || "gemini")
    .trim()
    .toLowerCase();
  const modelOverride = readModelOverride(argvOrEnv);

  if (requested === "ollama") {
    return resolveOllamaProvider(modelOverride);
  }
  if (requested !== "gemini") {
    throw new Error(`Unknown --provider "${requested}" — expected "gemini" or "ollama".`);
  }
  return resolveGeminiProvider(modelOverride);
}

/**
 * `--model=<tag>`. Returns null when absent so each provider keeps its own
 * env default; an explicitly empty `--model=` is a mistake worth surfacing
 * rather than silently ignoring.
 */
export function readModelOverride(argvOrEnv = process.argv.slice(2)) {
  const flag = argvOrEnv.find((arg) => arg.startsWith("--model="));
  if (!flag) return null;
  const value = flag.slice("--model=".length).trim();
  if (!value) throw new Error("--model= was passed with no model tag.");
  return value;
}

async function resolveGeminiProvider(modelOverride = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY missing — required for --provider=gemini.");
  }
  // GeminiProvider reads its model from the GEMINI_MODEL env var at import
  // time, so a --model override has to be in the environment when the module
  // is first imported — it cannot be passed as an argument.
  //
  // The variable is then RESTORED, because it is not private to this function:
  // sage-quality-eval.mjs reads GEMINI_MODEL to choose its LLM judge. Leaving
  // the override in place would swap the grader along with the subject, so a
  // run would be scored by a different rubric than the recorded baseline and
  // silently incomparable to it. The module const has already captured the
  // override by the time we put the old value back, so the SUBJECT still uses
  // the requested model.
  const previous = process.env.GEMINI_MODEL;
  if (modelOverride) process.env.GEMINI_MODEL = modelOverride;
  let provider;
  try {
    const { GeminiProvider } = await import("../../src/lib/ai/gemini-provider.ts");
    provider = new GeminiProvider(apiKey);
  } finally {
    if (modelOverride) {
      if (previous === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = previous;
    }
  }
  const model = modelOverride || previous?.trim() || "gemini-3.1-flash-lite";
  return { provider, model, label: `gemini (${model})` };
}

async function resolveOllamaProvider(modelOverride = null) {
  const url = process.env.OLLAMA_URL?.trim();
  const model = modelOverride || process.env.OLLAMA_MODEL?.trim();
  if (!url) throw new Error("OLLAMA_URL missing — required for --provider=ollama.");
  if (!model) {
    throw new Error("OLLAMA_MODEL missing — required for --provider=ollama (or pass --model=).");
  }

  const { OllamaProvider } = await import("../../src/lib/ai/ollama-provider.ts");
  const { resolveLocalAiAuthMode } = await import("../../src/lib/ai/local-auth.ts");

  const authMode = resolveLocalAiAuthMode(process.env.OLLAMA_AUTH_MODE ?? null);
  const authConfig = {
    authMode,
    apiKey: process.env.AI_PROVIDER_API_KEY || process.env.OLLAMA_API_KEY || null,
    cloudflareAccessClientId:
      process.env.AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_ID ||
      process.env.CF_ACCESS_CLIENT_ID ||
      process.env.CLOUDFLARE_ACCESS_CLIENT_ID ||
      null,
    cloudflareAccessClientSecret:
      process.env.AI_PROVIDER_CLOUDFLARE_ACCESS_CLIENT_SECRET ||
      process.env.CF_ACCESS_CLIENT_SECRET ||
      process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET ||
      null,
  };

  const provider = new OllamaProvider(url, model, authConfig);
  return { provider, model, url, label: `ollama (${model} @ ${url})` };
}
