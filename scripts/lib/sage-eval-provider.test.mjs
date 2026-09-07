import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readDeidentifyNames,
  describeDeidentify,
  wrapWithDeidentification,
  isBudgetExhausted,
  wrapWithBudgetDetection,
  EvalBudgetExhaustedError,
  reportEvalFailure,
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
