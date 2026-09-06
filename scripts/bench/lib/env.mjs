/**
 * `requires` -> environment checks.
 *
 * A suite declares what it needs to be meaningful; the runner checks whether
 * the environment supplies it and marks the suite `skipped` when it does not.
 * Skipped is never a failure: the three missing secrets are owner steps
 * (design §9.7), and a benchmark that reds a PR because a key was never set
 * teaches everyone to ignore the gate.
 *
 * The seven requirements map onto six variables — `postgres` and `cohort`
 * share DATABASE_URL, because a seeded cohort is a state of that same
 * database (the runner's CI step seeds it via scripts/bench/seed-cohort.ts).
 */

export const REQUIREMENT_ENV = Object.freeze({
  postgres: "DATABASE_URL",
  cohort: "DATABASE_URL",
  gemini: "GEMINI_API_KEY",
  ollama: "OLLAMA_HOST",
  browser: "PLAYWRIGHT",
  "prod-readonly": "BENCH_PROD_READONLY_URL",
  server: "BENCH_BASE_URL",
});

export const REQUIREMENTS = Object.freeze(Object.keys(REQUIREMENT_ENV));

/** A variable counts as set only when it holds non-whitespace text. */
function present(env, name) {
  const value = env?.[name];
  return typeof value === "string" && value.trim().length > 0;
}

function orNull(env, name) {
  return present(env, name) ? env[name] : null;
}

/**
 * @param {readonly string[]|undefined} requires
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ met: boolean, missing: {requirement: string, envVar: string}[], unknown: string[] }}
 */
export function checkRequires(requires, env = process.env) {
  const list = Array.isArray(requires) ? requires : [];
  const missing = [];
  const unknown = [];

  for (const requirement of list) {
    const envVar = REQUIREMENT_ENV[requirement];
    if (!envVar) {
      // An unknown requirement is reported, never treated as satisfied — the
      // fail-safe direction is "we do not know, so do not run it".
      unknown.push(requirement);
      continue;
    }
    if (!present(env, envVar) && !missing.some((m) => m.envVar === envVar)) {
      missing.push({ requirement, envVar });
    }
  }

  return { met: missing.length === 0 && unknown.length === 0, missing, unknown };
}

/**
 * One human-readable line naming what stopped a suite from running.
 * @param {{ missing: {requirement: string, envVar: string}[], unknown: string[] }} check
 */
export function describeUnmet(check) {
  const parts = check.missing.map((m) => `requires ${m.requirement} (${m.envVar} is not set)`);
  for (const requirement of check.unknown) parts.push(`unknown requirement "${requirement}"`);
  return parts.join("; ");
}

/**
 * The `ctx.env` handed to every scorer. Values are `null`, never `undefined`,
 * so `if (ctx.env.databaseUrl)` and `ctx.env.databaseUrl ?? fallback` both
 * behave the way an author expects.
 *
 * `databaseUrl`, `geminiApiKey`, `ollamaHost` and `baseUrl` are the four keys
 * the shared contract names; `prodReadonlyUrl` and `playwright` are added so
 * the `prod-readonly` and `browser` requirements have somewhere to land
 * (additive — no contract key changed meaning).
 *
 * @param {Record<string, string|undefined>} [env]
 */
export function resolveEnv(env = process.env) {
  return {
    databaseUrl: orNull(env, "DATABASE_URL"),
    geminiApiKey: orNull(env, "GEMINI_API_KEY"),
    ollamaHost: orNull(env, "OLLAMA_HOST"),
    baseUrl: orNull(env, "BENCH_BASE_URL"),
    prodReadonlyUrl: orNull(env, "BENCH_PROD_READONLY_URL"),
    playwright: orNull(env, "PLAYWRIGHT"),
  };
}
