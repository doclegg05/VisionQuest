#!/usr/bin/env node
/**
 * One CI step of the Sage Evals workflow (.github/workflows/sage-evals.yml).
 *
 *   node scripts/lib/sage-eval-ci-step.mjs --label="Red-team eval" [--informational]
 *     [--needs-embeddings] -- <eval command...>
 *
 * Every model-backed step runs through here, so "a skipped or unrunnable eval
 * never reads as a pass" is decided in one tested place. Each step writes one
 * line to the job summary:
 *
 *   PASSED / REPORTED  the eval ran and exited 0 (REPORTED for --informational
 *                      steps, which have no pass criterion)
 *   FAILED             the eval ran and exited non-zero for a real reason
 *   NOT RUN            nothing was evaluated:
 *                      - a secret is missing: exit 0 on a fork PR, which never
 *                        gets secrets; exit 4 when SAGE_EVAL_REQUIRED is
 *                        "true" (this repository, which should hold them)
 *                      - credits or the key's spending limit ran out (exit 3)
 *                      - the key, model or provider was unavailable (exit 4)
 *                      SAGE_EVAL_SOFT_FAIL=1 turns any NOT RUN exit into 0.
 *
 * The budget is each key's own spending limit; there is no opt-in variable.
 *
 * --needs-embeddings marks a step that embeds through the app's embedding
 * resolver, which the eval harness points at OpenRouter's
 * google/gemini-embedding-001. One embedding call checks the key first, and
 * again after a failed eval, because the app swallows embedding errors: a key
 * that is refused, or a wallet that drains mid-run, would otherwise read as a
 * 0% retrieval score.
 *
 * Runbook: docs/runbooks/sage-eval-budget.md. Tests:
 * src/lib/sage/eval-ci-step.test.ts and src/lib/ci-sage-evals-openrouter.test.ts.
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SOFT_FAIL_VAR = "SAGE_EVAL_SOFT_FAIL";
export const REQUIRED_VAR = "SAGE_EVAL_REQUIRED";
export const EMBEDDING_PREFLIGHT_COMMAND = Object.freeze([
  "node",
  "--import",
  "tsx",
  "scripts/sage-embedding-preflight.mjs",
]);

const EXIT_BUDGET = 3;
const EXIT_UNAVAILABLE = 4;
const FLAGS = new Set(["--informational", "--needs-embeddings"]);
const USAGE =
  'Usage: sage-eval-ci-step.mjs --label="<name>" [--informational] [--needs-embeddings] -- <command...>';

/** Parses the step's own flags and the eval command after the first `--`. */
export function parseStepArgs(argv) {
  const split = argv.indexOf("--");
  if (split === -1) throw new Error(`Missing -- before the command. ${USAGE}`);
  const flags = argv.slice(0, split);
  const command = argv.slice(split + 1);
  const label = flags.find((flag) => flag.startsWith("--label="))?.slice("--label=".length).trim();
  if (!label) throw new Error(`Missing --label. ${USAGE}`);
  const unknown = flags.find((flag) => !flag.startsWith("--label=") && !FLAGS.has(flag));
  if (unknown) throw new Error(`Unknown flag ${unknown}. ${USAGE}`);
  if (command.length === 0) throw new Error(`Missing the command after --. ${USAGE}`);
  return {
    label,
    informational: flags.includes("--informational"),
    needsEmbeddings: flags.includes("--needs-embeddings"),
    command,
  };
}

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function line(step, result) {
  return `- **${step.label}**: ${result}`;
}

function notRunExit(code, env) {
  return env[SOFT_FAIL_VAR] === "1" ? 0 : code;
}

function missingSecret(step, name, env) {
  const reason = `${name} secret not set`;
  const summary = line(step, `NOT RUN — ${reason}`);
  if (env[REQUIRED_VAR] !== "true") {
    return { exitCode: 0, annotation: `::notice::${reason} — ${step.label} skipped (not run, not passed)`, summary };
  }
  return {
    exitCode: notRunExit(EXIT_UNAVAILABLE, env),
    annotation: `::error::${reason} — ${step.label} NOT RUN, and this repository should hold the secret (not a pass)`,
    summary,
  };
}

/** Null when the step may call a model; otherwise its NOT RUN outcome. */
export function skipReason(step, env) {
  if (!present(env.OPENROUTER_API_KEY)) return missingSecret(step, "OPENROUTER_API_KEY", env);
  return null;
}

const CAUSES = Object.freeze({
  eval: { cause: "OpenRouter", when: "" },
  preflight: { cause: "OpenRouter embeddings", when: "" },
  recheck: { cause: "OpenRouter embeddings", when: ", found after the eval failed" },
});

/**
 * Maps an exit code to the step's outcome. `stage` is "eval" for the eval
 * itself (which calls OpenRouter), "preflight" for the embedding key check
 * before it, and "recheck" for the same check after the eval failed.
 */
export function outcomeForExit(step, stage, code, env) {
  const { cause, when } = CAUSES[stage];
  if (code === 0) {
    return {
      exitCode: 0,
      annotation: null,
      summary: line(step, step.informational ? "REPORTED — informational, no pass criterion" : "PASSED"),
    };
  }
  if (code === EXIT_BUDGET) {
    return {
      exitCode: notRunExit(EXIT_BUDGET, env),
      annotation: `::warning::${cause} budget exhausted at runtime — ${step.label} NOT RUN (not a pass, not a code failure)`,
      summary: line(step, `NOT RUN — ${cause} budget exhausted at runtime${when}`),
    };
  }
  if (code === EXIT_UNAVAILABLE) {
    return {
      exitCode: notRunExit(EXIT_UNAVAILABLE, env),
      annotation: `::error::${step.label} NOT RUN — ${cause} refused the key or model, or could not be reached (not a pass)`,
      summary: line(step, `NOT RUN — ${cause} key, model or connection unavailable${when}`),
    };
  }
  const exitCode = typeof code === "number" ? code : 1;
  const where = stage === "preflight" ? "embedding preflight exit" : "exit";
  return { exitCode, annotation: null, summary: line(step, `FAILED (${where} ${code ?? "signal"})`) };
}

function isNotRun(code) {
  return code === EXIT_BUDGET || code === EXIT_UNAVAILABLE;
}

/** Runs the step with `run(command, env) => exit code` and returns its outcome. */
export async function runStep(step, env, run) {
  const skip = skipReason(step, env);
  if (skip) return skip;
  if (step.needsEmbeddings) {
    const code = await run(EMBEDDING_PREFLIGHT_COMMAND, env);
    if (code !== 0) return outcomeForExit(step, "preflight", code, env);
  }
  const code = await run(step.command, env);
  if (step.needsEmbeddings && code !== 0 && !isNotRun(code)) {
    const recheck = await run(EMBEDDING_PREFLIGHT_COMMAND, env);
    if (isNotRun(recheck)) return outcomeForExit(step, "recheck", recheck, env);
  }
  return outcomeForExit(step, "eval", code, env);
}

function spawnCommand([command, ...args], env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", (error) => {
      console.error(`Could not start ${command}: ${error.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code));
  });
}

function report(outcome, env) {
  if (outcome.annotation) console.log(outcome.annotation);
  console.log(outcome.summary);
  if (present(env.GITHUB_STEP_SUMMARY)) appendFileSync(env.GITHUB_STEP_SUMMARY, `${outcome.summary}\n`);
}

async function main() {
  const step = parseStepArgs(process.argv.slice(2));
  const outcome = await runStep(step, process.env, spawnCommand);
  report(outcome, process.env);
  process.exitCode = outcome.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
