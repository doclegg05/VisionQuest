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

  if (requested !== "ollama" && requested !== "gemini") {
    throw new Error(`Unknown --provider "${requested}" — expected "gemini" or "ollama".`);
  }
  const resolved =
    requested === "ollama"
      ? await resolveOllamaProvider(modelOverride)
      : await resolveGeminiProvider(modelOverride);

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
  constructor(cause) {
    super("Gemini eval budget exhausted (429: prepayment/credits/quota) — evals not run.");
    this.name = "EvalBudgetExhaustedError";
    if (cause !== undefined) this.cause = cause;
  }
}

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

/** Reclassifies a budget-exhausted error and rethrows; every other error is rethrown untouched. */
function classifyAndRethrow(error) {
  const { status, bodyText } = describeProviderError(error);
  if (isBudgetExhausted(status, bodyText)) throw new EvalBudgetExhaustedError(error);
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
  const wrapped = {
    name: provider.name,
    async generateResponse(...args) {
      try {
        return await provider.generateResponse(...args);
      } catch (error) {
        classifyAndRethrow(error);
      }
    },
    async *streamResponse(...args) {
      try {
        yield* provider.streamResponse(...args);
      } catch (error) {
        classifyAndRethrow(error);
      }
    },
    async generateStructuredResponse(...args) {
      try {
        return await provider.generateStructuredResponse(...args);
      } catch (error) {
        classifyAndRethrow(error);
      }
    },
  };

  if (provider.streamWithTools) {
    wrapped.streamWithTools = async function* (...args) {
      try {
        yield* provider.streamWithTools(...args);
      } catch (error) {
        classifyAndRethrow(error);
      }
    };
  }
  if (provider.describeDocument) {
    wrapped.describeDocument = async (...args) => {
      try {
        return await provider.describeDocument(...args);
      } catch (error) {
        classifyAndRethrow(error);
      }
    };
  }

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
  if (error instanceof EvalBudgetExhaustedError) {
    console.error("::error::Gemini budget exhausted — evals not run");
    console.error(error);
    process.exitCode = 3;
    return;
  }
  console.error(error);
  process.exitCode = 1;
}
