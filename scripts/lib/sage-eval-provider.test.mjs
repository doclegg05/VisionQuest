import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  readDeidentifyNames,
  describeDeidentify,
  wrapWithDeidentification,
  isBudgetExhausted,
  wrapWithBudgetDetection,
  EvalBudgetExhaustedError,
  reportEvalFailure,
  resolveEvalProvider,
  EvalProviderUnavailableError,
  EvalProviderUnreachableError,
  isEvalAbort,
  classifyEmbeddingFailure,
  trackEvalAborts,
} from "./sage-eval-provider.mjs";

/**
 * AC5 — the eval harness must be able to measure the SHIPPED configuration.
 *
 * Production wraps every cloud `student_record` call in the de-identification
 * decorator, so an eval run against a raw provider measures a prompt no
 * student will ever produce. `--deidentify=Sam,Ms. Lee` puts the same
 * decorator in front of the eval's provider, and the label records it so a
 * run's provenance says which arm it was.
 */

describe("readDeidentifyNames", () => {
  it("returns null when the flag is absent — the default arm is unwrapped", () => {
    assert.equal(readDeidentifyNames(["--provider=gemini"]), null);
  });

  it("splits on commas and trims", () => {
    assert.deepEqual(readDeidentifyNames(["--deidentify=Sam, Ms. Lee"]), ["Sam", "Ms. Lee"]);
  });

  it("throws on an empty flag rather than silently running the unwrapped arm", () => {
    assert.throws(() => readDeidentifyNames(["--deidentify="]), /no names/i);
    assert.throws(() => readDeidentifyNames(["--deidentify=,, "]), /no names/i);
  });
});

describe("describeDeidentify", () => {
  it("names the arm in the label so a run's provenance shows it", () => {
    assert.equal(describeDeidentify(["Sam", "Ms. Lee"]), "deidentify(Sam, Ms. Lee)");
    assert.equal(describeDeidentify(null), "");
  });
});

describe("wrapWithDeidentification", () => {
  const fake = {
    name: "fake",
    lastSystemPrompt: null,
    async generateResponse(systemPrompt) {
      this.lastSystemPrompt = systemPrompt;
      return "Hi [STUDENT_NAME], ask [TEACHER_NAME_1].";
    },
    async *streamResponse() {
      yield "";
    },
    async generateStructuredResponse() {
      return "{}";
    },
  };

  it("returns the provider untouched when no names are given", async () => {
    assert.equal(await wrapWithDeidentification(fake, null), fake);
  });

  it("pseudonymises the first name as the student and the rest as staff", async () => {
    const wrapped = await wrapWithDeidentification(fake, ["Sam", "Ms. Lee"]);
    const reply = await wrapped.generateResponse("You are coaching Sam. Their teacher is Ms. Lee.", []);
    assert.equal(fake.lastSystemPrompt, "You are coaching [STUDENT_NAME]. Their teacher is [TEACHER_NAME_1].");
    assert.equal(reply, "Hi Sam, ask Ms. Lee.");
  });
});

/**
 * 2026-09-05: six eval runs drained the Gemini prepaid balance and every
 * Sage-touching PR read red for hours under a 429 "prepayment credits
 * depleted" — under the repo's rule an ungraded scenario is not a pass, so
 * red-for-money blocked merges exactly like a real regression would.
 * `isBudgetExhausted` must name the ONE 429 shape that means the wallet is
 * empty, and must NOT fire on an ordinary per-minute rate-limit 429 (which
 * stays a transient, retryable failure elsewhere in the codebase — see
 * `RETRYABLE_STATUSES` in src/lib/ai/gemini-provider.ts).
 */
describe("isBudgetExhausted", () => {
  it("is true for the exact incident wording: prepayment credits depleted", () => {
    assert.equal(isBudgetExhausted(429, "prepayment credits depleted"), true);
  });

  it("is true for 'insufficient credits' phrasing", () => {
    assert.equal(isBudgetExhausted(429, "Your account has insufficient credits to continue."), true);
  });

  it("is true for 'quota exhausted' phrasing", () => {
    assert.equal(isBudgetExhausted(429, "Your prepaid quota exhausted for this billing cycle."), true);
  });

  it("is FALSE for an ordinary per-minute rate-limit 429 — that must stay retryable, not a budget outage", () => {
    assert.equal(
      isBudgetExhausted(429, "You exceeded your current quota, please check your plan and billing details."),
      false,
    );
  });

  it("is false for budget wording on any non-429 status", () => {
    assert.equal(isBudgetExhausted(503, "prepayment credits depleted"), false);
    assert.equal(isBudgetExhausted(500, "insufficient credits"), false);
  });

  it("is false for missing, empty, or non-string body text", () => {
    assert.equal(isBudgetExhausted(429, null), false);
    assert.equal(isBudgetExhausted(429, ""), false);
    assert.equal(isBudgetExhausted(429, undefined), false);
  });
});

describe("wrapWithBudgetDetection", () => {
  function fakeProviderThrowingOnGenerate(error) {
    return {
      name: "fake",
      async generateResponse() {
        throw error;
      },
      async *streamResponse() {
        yield "";
      },
      async generateStructuredResponse() {
        return "{}";
      },
    };
  }

  it("rethrows a budget-exhausted 429 as EvalBudgetExhaustedError, from generateResponse", async () => {
    const error = new Error(
      "[GoogleGenerativeAI Error]: Error fetching from https://x: [429 Too Many Requests] prepayment credits depleted",
    );
    error.status = 429;
    const wrapped = wrapWithBudgetDetection(fakeProviderThrowingOnGenerate(error));
    await assert.rejects(() => wrapped.generateResponse("sys", []), EvalBudgetExhaustedError);
  });

  it("passes an unrelated error through untouched (not reclassified)", async () => {
    const wrapped = wrapWithBudgetDetection(fakeProviderThrowingOnGenerate(new Error("boom")));
    await assert.rejects(
      () => wrapped.generateResponse("sys", []),
      (err) => {
        assert.ok(!(err instanceof EvalBudgetExhaustedError));
        assert.equal(err.message, "boom");
        return true;
      },
    );
  });

  it("classifies a budget-exhausted error thrown mid-stream from streamResponse", async () => {
    const provider = {
      name: "fake",
      async generateResponse() {
        return "ok";
      },
      async *streamResponse() {
        yield "partial chunk";
        const error = new Error("quota exhausted");
        error.status = 429;
        throw error;
      },
      async generateStructuredResponse() {
        return "{}";
      },
    };
    const wrapped = wrapWithBudgetDetection(provider);
    async function drain() {
      const chunks = [];
      for await (const chunk of wrapped.streamResponse("sys", [])) chunks.push(chunk);
      return chunks;
    }
    await assert.rejects(drain, EvalBudgetExhaustedError);
  });

  it("classifies a budget-exhausted error from streamWithTools when the provider implements it", async () => {
    const error = new Error("prepayment credits depleted");
    error.status = 429;
    const provider = {
      name: "fake",
      async generateResponse() {
        return "ok";
      },
      async *streamResponse() {
        yield "";
      },
      async generateStructuredResponse() {
        return "{}";
      },
      async *streamWithTools() {
        throw error;
      },
    };
    const wrapped = wrapWithBudgetDetection(provider);
    assert.ok(wrapped.streamWithTools, "streamWithTools must stay capability-detected through the wrapper");
    async function drain() {
      const events = [];
      for await (const event of wrapped.streamWithTools("sys", [], [], async () => ({}))) events.push(event);
      return events;
    }
    await assert.rejects(drain, EvalBudgetExhaustedError);
  });

  it("does not add streamWithTools when the wrapped provider lacks it", () => {
    const wrapped = wrapWithBudgetDetection(fakeProviderThrowingOnGenerate(new Error("boom")));
    assert.equal(wrapped.streamWithTools, undefined);
  });
});

/**
 * Every eval script's `main().catch(reportEvalFailure)` — the shared
 * top-level handler the workflow's exit-code branching depends on.
 */
/**
 * A run whose provider was never reached evaluated nothing. Before
 * 2026-10-14 every eval graded each such case as a miss: with OpenRouter
 * unreachable the agent eval reported "0.0% (0/45)" and exited 0 without a
 * floor (1 with CI's floor), so a dead connection read as "ran" in both.
 * A network failure is "never reached" only if no call in the run has
 * succeeded yet; after that it stays an ordinary, graded failure.
 */
describe("wrapWithBudgetDetection — a provider that was never reached", () => {
  const openRouterNetwork = () =>
    Object.assign(new Error("OpenRouter request failed (network)"), { name: "OpenRouterError", kind: "network", status: null });
  const geminiFetchFailed = () =>
    new Error("[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/x: fetch failed");
  const openRouterTimeout = () =>
    Object.assign(new Error("OpenRouter request timed out after 30000ms"), { name: "OpenRouterError", kind: "unavailable", status: null });

  function provider(name, failWith, { succeedFirst = false } = {}) {
    let calls = 0;
    return {
      name,
      async generateResponse() {
        calls += 1;
        if (succeedFirst && calls === 1) return "ok";
        throw failWith();
      },
      async *streamResponse() {
        yield "";
      },
      async generateStructuredResponse() {
        return "{}";
      },
      async *streamWithTools() {
        calls += 1;
        if (succeedFirst && calls === 1) {
          yield { kind: "text", text: "ok" };
          return;
        }
        throw failWith();
      },
    };
  }

  it("aborts the run as unreachable when the first call cannot connect", async () => {
    const wrapped = wrapWithBudgetDetection(provider("openrouter", openRouterNetwork));
    await assert.rejects(
      () => wrapped.generateResponse("sys", []),
      (error) => error instanceof EvalProviderUnreachableError && isEvalAbort(error) && /OpenRouter/.test(error.message),
    );
  });

  it("recognises Gemini's 'fetch failed' the same way", async () => {
    const wrapped = wrapWithBudgetDetection(provider("gemini", geminiFetchFailed));
    await assert.rejects(
      () => wrapped.generateResponse("sys", []),
      (error) => error instanceof EvalProviderUnreachableError && /Gemini/.test(error.message),
    );
  });

  it("aborts from streamWithTools too, the call every tool eval makes", async () => {
    const wrapped = wrapWithBudgetDetection(provider("openrouter", openRouterNetwork));
    await assert.rejects(async () => {
      for await (const _event of wrapped.streamWithTools("sys", [], [], async () => ({}), {})) {
        // drain
      }
    }, EvalProviderUnreachableError);
  });

  it("grades a network failure as an ordinary error once any call has succeeded", async () => {
    const wrapped = wrapWithBudgetDetection(provider("openrouter", openRouterNetwork, { succeedFirst: true }));
    assert.equal(await wrapped.generateResponse("sys", []), "ok");
    await assert.rejects(
      () => wrapped.generateResponse("sys", []),
      (error) => !isEvalAbort(error) && error.message === "OpenRouter request failed (network)",
    );
  });

  it("counts a stream that delivered an event as reached", async () => {
    const wrapped = wrapWithBudgetDetection(provider("openrouter", openRouterNetwork, { succeedFirst: true }));
    for await (const _event of wrapped.streamWithTools("sys", [], [], async () => ({}), {})) {
      // drain the successful first call
    }
    await assert.rejects(async () => {
      for await (const _event of wrapped.streamWithTools("sys", [], [], async () => ({}), {})) {
        // drain
      }
    }, (error) => !isEvalAbort(error));
  });

  it("never treats a timeout as unreachable", async () => {
    const wrapped = wrapWithBudgetDetection(provider("openrouter", openRouterTimeout));
    await assert.rejects(
      () => wrapped.generateResponse("sys", []),
      (error) => !isEvalAbort(error) && /timed out/.test(error.message),
    );
  });
});

describe("reportEvalFailure", () => {
  function withCapturedExitCodeAndConsoleError(fn) {
    const originalExitCode = process.exitCode;
    const originalConsoleError = console.error;
    const loggedArgs = [];
    console.error = (...args) => loggedArgs.push(args);
    try {
      process.exitCode = undefined;
      fn();
      return { exitCode: process.exitCode, loggedArgs };
    } finally {
      process.exitCode = originalExitCode;
      console.error = originalConsoleError;
    }
  }

  it("sets exit code 3 and logs the named ::error:: line for a budget-exhausted run", () => {
    const budgetError = new EvalBudgetExhaustedError(new Error("prepayment credits depleted"));
    const { exitCode, loggedArgs } = withCapturedExitCodeAndConsoleError(() => reportEvalFailure(budgetError));
    assert.equal(exitCode, 3);
    assert.ok(
      loggedArgs.some((args) => args[0] === "::error::Gemini budget exhausted — evals not run"),
      `expected the named ::error:: line, got: ${JSON.stringify(loggedArgs)}`,
    );
  });

  it("sets exit code 4 and names the unreachable provider for a run that never connected", () => {
    const unreachable = new EvalProviderUnreachableError(new Error("fetch failed"), "OpenRouter");
    const { exitCode, loggedArgs } = withCapturedExitCodeAndConsoleError(() => reportEvalFailure(unreachable));
    assert.equal(exitCode, 4);
    assert.ok(
      loggedArgs.some((args) => args[0] === "::error::OpenRouter could not be reached — evals not run"),
      `expected the named ::error:: line, got: ${JSON.stringify(loggedArgs)}`,
    );
  });

  it("sets the ORDINARY exit code 1 for any other error, unchanged from today's behavior", () => {
    const ordinary = new Error("something else broke");
    const { exitCode, loggedArgs } = withCapturedExitCodeAndConsoleError(() => reportEvalFailure(ordinary));
    assert.equal(exitCode, 1);
    assert.ok(
      !loggedArgs.some((args) => args[0] === "::error::Gemini budget exhausted — evals not run"),
      "an ordinary failure must never print the budget-exhausted line",
    );
  });
});

async function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

describe("--provider=openrouter", () => {
  it("resolves an OpenRouter provider for the requested model", async () => {
    await withEnv("OPENROUTER_API_KEY", "sk-or-test-key-0123456789", async () => {
      const { provider, model, label } = await resolveEvalProvider([
        "--provider=openrouter",
        "--model=meta-llama/llama-3.3-70b-instruct",
      ]);
      assert.equal(provider.name, "openrouter");
      assert.equal(model, "meta-llama/llama-3.3-70b-instruct");
      assert.equal(label, "openrouter (meta-llama/llama-3.3-70b-instruct)");
    });
  });

  it("defaults to the production model", async () => {
    await withEnv("OPENROUTER_API_KEY", "sk-or-test-key-0123456789", async () => {
      const { model } = await resolveEvalProvider(["--provider=openrouter"]);
      assert.equal(model, "google/gemini-3.1-flash-lite");
    });
  });

  it("appends each call's billed cost to the file SAGE_EVAL_COST_LOG names", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vq-cost-log-"));
    const file = path.join(dir, "costs.log");
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.0031 },
        }),
        { status: 200 },
      );
    try {
      await withEnv("OPENROUTER_API_KEY", "test-key", () =>
        withEnv("SAGE_EVAL_COST_LOG", file, async () => {
          const { provider } = await resolveEvalProvider(["--provider=openrouter"]);
          await provider.generateResponse("sys", [{ role: "user", content: "q" }]);
          await provider.generateResponse("sys", [{ role: "user", content: "q" }]);
        }),
      );
      assert.equal(readFileSync(file, "utf8"), "0.0031\n0.0031\n");
    } finally {
      globalThis.fetch = realFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stops with a clear error when the key is missing", async () => {
    await withEnv("OPENROUTER_API_KEY", undefined, async () => {
      await assert.rejects(resolveEvalProvider(["--provider=openrouter"]), /OPENROUTER_API_KEY missing/);
    });
  });

  it("names all three providers when one is unknown", async () => {
    await assert.rejects(resolveEvalProvider(["--provider=claude"]), /"gemini", "ollama" or "openrouter"/);
  });
});

describe("OpenRouter credits", () => {
  function failingProvider(error) {
    return {
      name: "openrouter",
      async generateResponse() {
        throw error;
      },
      async *streamResponse() {
        throw error;
      },
      async generateStructuredResponse() {
        throw error;
      },
    };
  }

  function openRouterError(kind, status) {
    return Object.assign(new Error(`OpenRouter request failed (${status}, ${kind})`), {
      name: "OpenRouterError",
      kind,
      status,
    });
  }

  it("reports exhausted credits as budget exhausted", async () => {
    const wrapped = wrapWithBudgetDetection(failingProvider(openRouterError("credits", 402)));
    await assert.rejects(
      wrapped.generateResponse("sys", [{ role: "user", content: "q" }]),
      (err) => err instanceof EvalBudgetExhaustedError && err.providerLabel === "OpenRouter",
    );
  });

  it("leaves a refused 403 as a real failure", async () => {
    const refused = openRouterError("refused", 403);
    const wrapped = wrapWithBudgetDetection(failingProvider(refused));
    await assert.rejects(wrapped.generateResponse("sys", [{ role: "user", content: "q" }]), (err) => err === refused);
  });

  it("names OpenRouter in the not-run line and exits 3", () => {
    const logged = [];
    const originalError = console.error;
    const originalExitCode = process.exitCode;
    console.error = (...args) => logged.push(args[0]);
    try {
      reportEvalFailure(new EvalBudgetExhaustedError(undefined, "OpenRouter"));
      assert.ok(logged.includes("::error::OpenRouter budget exhausted \u2014 evals not run"));
      assert.equal(process.exitCode, 3);
    } finally {
      console.error = originalError;
      process.exitCode = originalExitCode;
    }
  });
});

describe("OpenRouter unavailable models and keys", () => {
  function failing(error) {
    return {
      name: "openrouter",
      async generateResponse() {
        throw error;
      },
      async *streamResponse() {
        throw error;
      },
      async generateStructuredResponse() {
        throw error;
      },
    };
  }

  function openRouterError(kind, status) {
    return Object.assign(new Error(`OpenRouter request failed (${status}, ${kind})`), {
      name: "OpenRouterError",
      kind,
      status,
    });
  }

  for (const status of [400, 401, 404]) {
    it(`reports a ${status} bad request as unavailable, not as a failed test`, async () => {
      const wrapped = wrapWithBudgetDetection(failing(openRouterError("bad_request", status)));
      await assert.rejects(
        wrapped.generateResponse("sys", [{ role: "user", content: "q" }]),
        (err) => err instanceof EvalProviderUnavailableError && err.providerLabel === "OpenRouter",
      );
    });
  }

  it("leaves a model's malformed tool-call JSON as a real failure", async () => {
    const malformed = openRouterError("bad_request", null);
    const wrapped = wrapWithBudgetDetection(failing(malformed));
    await assert.rejects(wrapped.generateResponse("sys", [{ role: "user", content: "q" }]), (err) => err === malformed);
  });

  it("isEvalAbort is true only for not-run errors", () => {
    assert.equal(isEvalAbort(new EvalBudgetExhaustedError(undefined, "OpenRouter")), true);
    assert.equal(isEvalAbort(new EvalProviderUnavailableError(undefined, "OpenRouter")), true);
    assert.equal(isEvalAbort(new Error("boom")), false);
    assert.equal(isEvalAbort(undefined), false);
  });

  it("names the unavailable provider and exits 4", () => {
    const logged = [];
    const originalError = console.error;
    const originalExitCode = process.exitCode;
    console.error = (...args) => logged.push(args[0]);
    try {
      reportEvalFailure(new EvalProviderUnavailableError(undefined, "OpenRouter"));
      assert.ok(logged.includes("::error::OpenRouter provider or model unavailable — evals not run"));
      assert.equal(process.exitCode, 4);
    } finally {
      console.error = originalError;
      process.exitCode = originalExitCode;
    }
  });
});

describe("--provider=openrouter refuses a non-local database", () => {
  const DB_VARS = ["DATABASE_URL", "DIRECT_URL", "ADMIN_DATABASE_URL", "BENCH_PROD_READONLY_URL"];

  async function withDbEnv(values, fn) {
    const saved = Object.fromEntries([...DB_VARS, "OPENROUTER_API_KEY"].map((name) => [name, process.env[name]]));
    for (const name of DB_VARS) delete process.env[name];
    Object.assign(process.env, { OPENROUTER_API_KEY: "sk-or-test-key-0123456789" }, values);
    try {
      return await fn();
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }

  it("refuses a remote DATABASE_URL and names the variable without printing it", async () => {
    await withDbEnv({ DATABASE_URL: "postgresql://app:hunter2secret@db.abcdef.supabase.co:5432/postgres" }, async () => {
      await assert.rejects(resolveEvalProvider(["--provider=openrouter"]), (err) => {
        assert.match(err.message, /DATABASE_URL/);
        assert.match(err.message, /non-local database/);
        assert.equal(err.message.includes("supabase.co"), false, err.message);
        assert.equal(err.message.includes("hunter2secret"), false, err.message);
        return true;
      });
    });
  });

  it("checks every database variable, not just DATABASE_URL", async () => {
    await withDbEnv({ BENCH_PROD_READONLY_URL: "postgres://ro:pw@prod.example.com/db" }, async () => {
      await assert.rejects(resolveEvalProvider(["--provider=openrouter"]), /BENCH_PROD_READONLY_URL/);
    });
  });

  it("refuses a database URL it cannot parse", async () => {
    await withDbEnv({ DIRECT_URL: "not a url" }, async () => {
      await assert.rejects(resolveEvalProvider(["--provider=openrouter"]), /DIRECT_URL/);
    });
  });

  it("allows loopback and unset database URLs", async () => {
    for (const url of ["postgresql://none@127.0.0.1:1/none", "postgres://u@localhost/db", "postgres://u@[::1]:5432/db"]) {
      await withDbEnv({ DATABASE_URL: url }, async () => {
        const { provider } = await resolveEvalProvider(["--provider=openrouter"]);
        assert.equal(provider.name, "openrouter");
      });
    }
    await withDbEnv({}, async () => {
      const { provider } = await resolveEvalProvider(["--provider=openrouter"]);
      assert.equal(provider.name, "openrouter");
    });
  });
});

describe("classifyEmbeddingFailure", () => {
  const embeddingError = (status, body) => new Error(`Embedding request failed: ${status} ${body}`);

  it("reads Google's invalid-key 400 as unavailable, not as a failed eval", () => {
    const error = classifyEmbeddingFailure(
      embeddingError(400, '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"'),
    );
    assert.ok(error instanceof EvalProviderUnavailableError);
    assert.equal(error.providerLabel, "Gemini embeddings");
  });

  it("reads 401, 403 and 404 as unavailable", () => {
    for (const status of [401, 403, 404]) {
      assert.ok(classifyEmbeddingFailure(embeddingError(status, "{}")) instanceof EvalProviderUnavailableError, String(status));
    }
  });

  it("reads a drained wallet as budget exhausted and an ordinary rate limit as itself", () => {
    const drained = classifyEmbeddingFailure(embeddingError(429, "Your prepayment credits are depleted."));
    assert.ok(drained instanceof EvalBudgetExhaustedError);
    const limited = embeddingError(429, "You exceeded your current quota, please check your plan and billing details.");
    assert.equal(classifyEmbeddingFailure(limited), limited);
  });

  it("reads a connection that never happened as unreachable", () => {
    const error = classifyEmbeddingFailure(new TypeError("fetch failed"));
    assert.ok(error instanceof EvalProviderUnreachableError);
  });

  it("leaves any other error alone, including a 400 that is not about the key", () => {
    const server = embeddingError(500, "internal");
    assert.equal(classifyEmbeddingFailure(server), server);
    const badInput = embeddingError(400, '{"error":{"message":"Request payload size exceeds the limit"}}');
    assert.equal(classifyEmbeddingFailure(badInput), badInput);
  });
});

describe("trackEvalAborts", () => {
  const abort = new EvalBudgetExhaustedError(undefined, "OpenRouter");

  function provider(failWith) {
    return {
      name: "openrouter",
      generateResponse: async () => "ok",
      generateStructuredResponse: async () => {
        if (failWith) throw failWith;
        return "{}";
      },
      async *streamResponse() {
        if (failWith) throw failWith;
        yield "ok";
      },
    };
  }

  it("remembers an abort even when the caller swallows it, as memory extraction does", async () => {
    const tracked = trackEvalAborts(provider(abort));
    await tracked.provider.generateStructuredResponse("system", []).catch(() => undefined);
    assert.throws(() => tracked.throwIfAborted(), (error) => error === abort);
  });

  it("remembers an abort thrown from a stream", async () => {
    const tracked = trackEvalAborts(provider(abort));
    await (async () => {
      for await (const chunk of tracked.provider.streamResponse("system", [])) void chunk;
    })().catch(() => undefined);
    assert.throws(() => tracked.throwIfAborted(), (error) => error === abort);
  });

  it("does not treat an ordinary failure as an abort", async () => {
    const tracked = trackEvalAborts(provider(new Error("model returned bad JSON")));
    await tracked.provider.generateStructuredResponse("system", []).catch(() => undefined);
    assert.doesNotThrow(() => tracked.throwIfAborted());
  });

  it("passes results through and keeps optional capabilities truthful", async () => {
    const tracked = trackEvalAborts(provider(null));
    assert.equal(await tracked.provider.generateResponse("system", []), "ok");
    assert.equal(tracked.provider.name, "openrouter");
    assert.equal("streamWithTools" in tracked.provider, false);
    assert.doesNotThrow(() => tracked.throwIfAborted());
  });
});
