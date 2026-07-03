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
 */

export async function resolveEvalProvider(argvOrEnv = process.argv.slice(2)) {
  const flag = argvOrEnv.find((arg) => arg.startsWith("--provider="));
  const requested = (flag ? flag.slice("--provider=".length) : process.env.SAGE_EVAL_PROVIDER || "gemini")
    .trim()
    .toLowerCase();

  if (requested === "ollama") {
    return resolveOllamaProvider();
  }
  if (requested !== "gemini") {
    throw new Error(`Unknown --provider "${requested}" — expected "gemini" or "ollama".`);
  }
  return resolveGeminiProvider();
}

async function resolveGeminiProvider() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY missing — required for --provider=gemini.");
  }
  const { GeminiProvider } = await import("../../src/lib/ai/gemini-provider.ts");
  const provider = new GeminiProvider(apiKey);
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
  return { provider, label: `gemini (${model})` };
}

async function resolveOllamaProvider() {
  const url = process.env.OLLAMA_URL?.trim();
  const model = process.env.OLLAMA_MODEL?.trim();
  if (!url) throw new Error("OLLAMA_URL missing — required for --provider=ollama.");
  if (!model) throw new Error("OLLAMA_MODEL missing — required for --provider=ollama.");

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
  return { provider, label: `ollama (${model} @ ${url})` };
}
