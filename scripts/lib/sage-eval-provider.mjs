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
 * `--provider` selects the provider CLASS (`gemini`, `ollama` or the eval-only
 * `openrouter`); `--model` selects the model tag within it, overriding
 * OLLAMA_MODEL / GEMINI_MODEL / OPENROUTER_MODEL. This is the single
 * chokepoint every model-driving eval resolves through, so a model flag added
 * here reaches all of them — which is what makes a per-model bake-off possible
 * without mutating global configuration between arms.
 *
 * `--deidentify=<name>[,<name>…]` wraps the resolved provider in the SAME
 * de-identification decorator production applies inside `resolveAiProvider`
 * for a cloud `student_record` call (src/lib/ai/with-deidentification.ts).
 * Without it an eval measures a prompt no student will ever produce. The
 * first name is the student, the rest are staff; the arm is named in the
 * label so a run's provenance records which one it was.
 */

export async function resolveEvalProvider(argvOrEnv = process.argv.slice(2)) {
  const flag = argvOrEnv.find((arg) => arg.startsWith("--provider="));
  const requested = (flag ? flag.slice("--provider=".length) : process.env.SAGE_EVAL_PROVIDER || "gemini")
    .trim()
    .toLowerCase();
  const modelOverride = readModelOverride(argvOrEnv);
  const deidentifyNames = readDeidentifyNames(argvOrEnv);

  const RESOLVERS = {
    gemini: resolveGeminiProvider,
    ollama: resolveOllamaProvider,
    openrouter: resolveOpenRouterProvider,
  };
  const resolve = RESOLVERS[requested];
  if (!resolve) {
    throw new Error(`Unknown --provider "${requested}". Expected "gemini", "ollama" or "openrouter".`);
  }
  const resolved = await resolve(modelOverride);

  const deidentified = deidentifyNames
    ? {
        ...resolved,
        provider: await wrapWithDeidentification(resolved.provider, deidentifyNames),
        deidentify: deidentifyNames,
        label: `${resolved.label} + ${describeDeidentify(deidentifyNames)}`,
      }
    : resolved;

  // Always wrapped, both providers: a budget-exhausted 429 only ever comes
  // from Gemini, but wrapping unconditionally means every eval script gets
  // the classification with no call-site branch on which provider it asked
  // for. Ollama errors never match the pattern (see isBudgetExhausted) and
  // pass through completely unchanged.
  return { ...deidentified, provider: wrapWithBudgetDetection(deidentified.provider) };
}

/**
 * `--deidentify=Sam,Ms. Lee`. Returns null when absent (the unwrapped arm);
 * throws on an empty or all-blank value, because a typo must not silently
 * run the arm the operator did not ask for.
 */
export function readDeidentifyNames(argvOrEnv = process.argv.slice(2)) {
  const flag = argvOrEnv.find((arg) => arg.startsWith("--deidentify="));
  if (!flag) return null;
  const names = flag
    .slice("--deidentify=".length)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) throw new Error("--deidentify= was passed with no names.");
  return names;
}

/** Label fragment recording the arm. Empty string when unwrapped. */
export function describeDeidentify(names) {
  return names && names.length > 0 ? `deidentify(${names.join(", ")})` : "";
}

/**
 * Wrap `provider` exactly as production does: first name is the student, the
 * rest are staff. Imported dynamically so a run that does not pass the flag
 * never loads the TS modules.
 */
export async function wrapWithDeidentification(provider, names) {
  if (!names || names.length === 0) return provider;
  const [{ TokenVault }, { withDeidentification }, { DEIDENTIFY_ALLOWLIST }] = await Promise.all([
    import("../../src/lib/ai/deidentify.ts"),
    import("../../src/lib/ai/with-deidentification.ts"),
    import("../../src/lib/ai/deidentify-allowlist.ts"),
  ]);
  const vault = TokenVault.fromIdentity(
    { studentName: names[0], staffNames: names.slice(1) },
    { allowlist: DEIDENTIFY_ALLOWLIST },
  );
  return withDeidentification(provider, vault);
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

/**
 * OpenRouter is eval-only: synthetic fixtures, never real student data (see
 * docs/runbooks/openrouter-test-bench.md). --model takes any OpenRouter model
 * id; the default matches production's Gemini model.
 */
const DATABASE_ENV_NAMES = ["DATABASE_URL", "DIRECT_URL", "ADMIN_DATABASE_URL", "BENCH_PROD_READONLY_URL"];
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopbackDatabaseUrl(value) {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * OpenRouter runs must never sit next to a real database. Eval scripts call
 * loadEnvFile(".env.local"), and a worktree's .env.local can be a symlink to
 * the production file, so a memory or grounding eval would read and write
 * production rows while sending prompts to OpenRouter. Names the variable,
 * never its value.
 */
export function assertNoRemoteDatabase(env = process.env) {
  for (const name of DATABASE_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value && !isLoopbackDatabaseUrl(value)) {
      throw new Error(
        `--provider=openrouter refuses to run with a non-local database in ${name}. OpenRouter is for synthetic data only: ` +
          `run from a directory without .env.local, or set ${name} to a local or dummy value such as postgresql://none@127.0.0.1:1/none.`,
      );
    }
  }
}

async function resolveOpenRouterProvider(modelOverride = null) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY missing: required for --provider=openrouter.");
  }
  assertNoRemoteDatabase();
  const { OpenRouterProvider, OPENROUTER_DEFAULT_MODEL } = await import("../../src/lib/ai/openrouter-provider.ts");
  const model = modelOverride || process.env.OPENROUTER_MODEL?.trim() || OPENROUTER_DEFAULT_MODEL;
  return { provider: new OpenRouterProvider(apiKey, model), model, label: `openrouter (${model})` };
}

/**
 * Ticket E8 (2026-09-07): 2026-09-05 six eval runs drained the Gemini
 * prepaid balance and every Sage-touching PR read red for hours on a 429
 * "prepayment credits depleted" — under the repo's rule an ungraded
 * scenario is not a pass, so a drained wallet blocked merges exactly like a
 * real regression would, with no way in the log to tell the two apart.
 *
 * Thrown by `wrapWithBudgetDetection` instead of the provider's original
 * error, ONLY when the failure is the specific "wallet is empty" 429 (see
 * `isBudgetExhausted`) — an ordinary transient rate-limit 429 is left alone
 * and surfaces as itself, because that case IS a real reason to fail loudly
 * (see RETRYABLE_STATUSES in src/lib/ai/gemini-provider.ts).
 *
 * A caller (each eval script's top-level `main().catch()`) checks
 * `instanceof EvalBudgetExhaustedError` to exit with a distinct code (3)
 * instead of the generic failure code (1), so CI and a human reading the log
 * can tell "not run, budget" from "ran and failed" at a glance. See
 * docs/runbooks/sage-eval-budget.md.
 */
export class EvalBudgetExhaustedError extends Error {
  constructor(cause, providerLabel = "Gemini") {
    super(
      providerLabel === "Gemini"
        ? "Gemini eval budget exhausted (429: prepayment/credits/quota) — evals not run."
        : `${providerLabel} eval budget exhausted (credits or key limit) \u2014 evals not run.`,
    );
    this.name = "EvalBudgetExhaustedError";
    this.providerLabel = providerLabel;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Thrown by `wrapWithBudgetDetection` when the provider refuses the model or
 * the key itself, so nothing could be evaluated: an OpenRouter 400 (unknown
 * model id), 401 (bad key) or 404 (no endpoint satisfies the zero-retention
 * routing rule). Exit code 4, so sage:models:compare and a human can tell
 * "this model is not available here" from "this model failed Sage's evals".
 */
export class EvalProviderUnavailableError extends Error {
  constructor(cause, providerLabel = "OpenRouter") {
    super(`${providerLabel} provider or model unavailable (bad model id, key, or routing rule) — evals not run.`);
    this.name = "EvalProviderUnavailableError";
    this.providerLabel = providerLabel;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Thrown by `wrapWithBudgetDetection` when a call fails at the network level
 * (the connection never happened) before any call in the run has succeeded:
 * the provider was never reached, so nothing was evaluated. A subclass of the
 * unavailable error, so every eval's per-case catch already rethrows it and
 * the run exits 4. Before this, each case was graded as a miss and a dead
 * connection read as "0.0%" (exit 0 without a floor, 1 with one).
 */
export class EvalProviderUnreachableError extends EvalProviderUnavailableError {
  constructor(cause, providerLabel) {
    super(cause, providerLabel);
    this.message = `${providerLabel} could not be reached (network) before any call succeeded — evals not run.`;
    this.name = "EvalProviderUnreachableError";
  }
}

/**
 * True when a call failed because no connection happened: OpenRouter's
 * "network" kind, or the "fetch failed" Gemini's SDK reports. Timeouts, 5xx
 * and broken replies are not network failures; the provider answered.
 */
export function isNetworkFailure(error) {
  if (error?.name === "OpenRouterError") return error.kind === "network";
  const text = [error?.message, error?.cause?.message].filter((part) => typeof part === "string").join(" ");
  return /fetch failed/i.test(text);
}

const PROVIDER_LABELS = { openrouter: "OpenRouter", gemini: "Gemini", ollama: "Ollama" };

/**
 * True for errors that mean "nothing can be evaluated", which every eval
 * script's per-case catch must rethrow instead of grading as a failed case.
 */
export function isEvalAbort(error) {
  return error instanceof EvalBudgetExhaustedError || error instanceof EvalProviderUnavailableError;
}

const UNAVAILABLE_STATUSES = new Set([400, 401, 404]);

/**
 * True only for the specific "prepaid wallet is empty" 429 shape, never for
 * an ordinary per-minute/per-day rate limit (also always a 429). The match
 * text is deliberately narrow for that reason: "quota" alone appears on
 * ordinary RESOURCE_EXHAUSTED rate-limit bodies too (Gemini's stock message
 * is "You exceeded your current quota, please check your plan and billing
 * details."), so "quota" only counts here when paired with "exhaust" — the
 * wording actually seen for the drained-balance case, distinct from the
 * quota-per-minute case that must stay a normal, retryable failure.
 */
const BUDGET_EXHAUSTED_PATTERN =
  /prepayment|(?:credits?)[^.\n]{0,40}(?:depleted|exhausted|insufficient)|insufficient[^.\n]{0,20}credits?|quota[^.\n]{0,20}exhaust/i;

export function isBudgetExhausted(status, bodyText) {
  if (status !== 429) return false;
  if (typeof bodyText !== "string" || bodyText.length === 0) return false;
  return BUDGET_EXHAUSTED_PATTERN.test(bodyText);
}

/** Best-effort extraction of a provider error's status + body text, tolerant of any shape. */
function describeProviderError(error) {
  if (!error || typeof error !== "object") return { status: null, bodyText: "" };
  const status = typeof error.status === "number" ? error.status : null;
  const bodyText = [
    typeof error.message === "string" ? error.message : null,
    error.errorDetails ? JSON.stringify(error.errorDetails) : null,
  ]
    .filter(Boolean)
    .join(" ");
  return { status, bodyText };
}

/**
 * Reclassifies a budget-exhausted, unavailable or never-reached error and
 * rethrows; every other error is rethrown untouched. `run.reached` is false
 * until some call in this run has succeeded.
 */
function classifyAndRethrow(error, run) {
  if (error?.name === "OpenRouterError" && error.kind === "credits") {
    throw new EvalBudgetExhaustedError(error, "OpenRouter");
  }
  if (error?.name === "OpenRouterError" && error.kind === "bad_request" && UNAVAILABLE_STATUSES.has(error.status)) {
    throw new EvalProviderUnavailableError(error, "OpenRouter");
  }
  const { status, bodyText } = describeProviderError(error);
  if (isBudgetExhausted(status, bodyText)) throw new EvalBudgetExhaustedError(error);
  if (!run.reached && isNetworkFailure(error)) throw new EvalProviderUnreachableError(error, run.label);
  throw error;
}

/**
 * Wraps a resolved AIProvider so any error a live call throws is inspected
 * for the budget-exhausted shape and rethrown as `EvalBudgetExhaustedError`;
 * every other error (a real generation failure, a network error, an
 * ordinary transient rate limit) passes through completely unchanged. This
 * is the one chokepoint every model-driving eval script already resolves
 * through (`resolveEvalProvider` calls it unconditionally), so no eval
 * script needs its own try/catch around the provider call to get the
 * classification — only the top-level `main().catch()` needs to check
 * `instanceof EvalBudgetExhaustedError`.
 *
 * Structural copy of `withDeidentification`'s capability-detection for
 * `streamWithTools`/`describeDocument`: both stay present or absent on the
 * wrapper exactly as they were on the underlying provider, so
 * `Boolean(provider.streamWithTools)` remains truthful through the wrapper.
 */
export function wrapWithBudgetDetection(provider) {
  // One run per wrapped provider: `reached` flips on the first call that
  // returns, or the first event a stream yields, and never flips back.
  const run = { reached: false, label: PROVIDER_LABELS[provider.name] ?? provider.name };
  const call = async (method, args) => {
    try {
      const result = await provider[method](...args);
      run.reached = true;
      return result;
    } catch (error) {
      classifyAndRethrow(error, run);
    }
  };
  async function* stream(method, args) {
    try {
      for await (const item of provider[method](...args)) {
        run.reached = true;
        yield item;
      }
    } catch (error) {
      classifyAndRethrow(error, run);
    }
  }

  const wrapped = {
    name: provider.name,
    generateResponse: (...args) => call("generateResponse", args),
    streamResponse: (...args) => stream("streamResponse", args),
    generateStructuredResponse: (...args) => call("generateStructuredResponse", args),
  };
  if (provider.streamWithTools) wrapped.streamWithTools = (...args) => stream("streamWithTools", args);
  if (provider.describeDocument) wrapped.describeDocument = (...args) => call("describeDocument", args);
  return wrapped;
}

/**
 * Shared top-level failure handler for every eval script's `main().catch()`.
 * A budget-exhausted run gets its own exit code (3) and its own
 * `::error::` line so CI (and a human scanning the log) can tell "the
 * wallet was empty, nothing ran" from "it ran and something is actually
 * broken" (exit 1) without parsing prose. The distinct code is what
 * `.github/workflows/sage-evals.yml` keys its NOT-RUN-vs-FAIL handling on —
 * see docs/runbooks/sage-eval-budget.md.
 */
export function reportEvalFailure(error) {
  if (error instanceof EvalProviderUnreachableError) {
    console.error(`::error::${error.providerLabel} could not be reached — evals not run`);
    console.error(error);
    process.exitCode = 4;
    return;
  }
  if (error instanceof EvalProviderUnavailableError) {
    console.error(`::error::${error.providerLabel} provider or model unavailable — evals not run`);
    console.error(error);
    process.exitCode = 4;
    return;
  }
  if (error instanceof EvalBudgetExhaustedError) {
    console.error(`::error::${error.providerLabel ?? "Gemini"} budget exhausted \u2014 evals not run`);
    console.error(error);
    process.exitCode = 3;
    return;
  }
  console.error(error);
  process.exitCode = 1;
}
