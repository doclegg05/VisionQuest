import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { DEFAULT_GEMINI_MODEL } from "./gemini";

/**
 * 2026-10-15: the repo's GEMINI_API_KEY Actions secret was rejected by Google
 * (API_KEY_INVALID), so no Sage eval could run in CI, and while the budget
 * opt-in was unset every run skipped and read green. The live eval steps now
 * call the production model through OpenRouter on synthetic data, and every
 * one of them goes through scripts/lib/sage-eval-ci-step.mjs, which owns the
 * NOT RUN / PASSED / FAILED mapping (src/lib/sage/eval-ci-step.test.ts).
 *
 * A workflow has no unit under test, so this file is the acceptance test: it
 * reads .github/workflows/sage-evals.yml as text and pins the wiring.
 */

/** The workflow without its comment lines, so prose about a flag never counts as using it. */
const WORKFLOW = readFileSync(path.resolve(".github/workflows/sage-evals.yml"), "utf8")
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");
const RUNNER = "node scripts/lib/sage-eval-ci-step.mjs";
/** The eval commands that call a model, each of which must pass --provider=openrouter. */
const EVAL_COMMAND = /sage:(?:redteam|agent|quality|memory):eval|sage-chat-harness\.mjs/g;
/** Any Sage script or npm script a step runs. A new one calls a model unless listed as keyless below. */
const SAGE_SCRIPT = /\bsage:[a-z:-]+|\bscripts\/sage-[a-z-]+\.mjs/;
const KEYLESS_SAGE_SCRIPTS = new Set(["sage:freshness:eval"]);
const OPENROUTER_SECRET = "OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}";

/** Top-level jobs, keyed by id, each holding its own text. */
function jobs(yml: string): Map<string, string> {
  const body = yml.slice(yml.indexOf("\njobs:\n"));
  const starts = [...body.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)];
  return new Map(
    starts.map((match, index) => [match[1], body.slice(match.index, starts[index + 1]?.index ?? body.length)]),
  );
}

/** A job's steps, each starting at its "      - " line. */
function steps(job: string): string[] {
  return job.split(/\n(?= {6}- )/).filter((part) => part.startsWith("      - "));
}

/** The job's own text before its first step: runs-on, services, env. */
function jobHeader(job: string): string {
  return job.slice(0, job.indexOf("\n    steps:\n"));
}

function stepName(step: string): string {
  return step.match(/- name: ([^\n]*)/)?.[1] ?? step.slice(0, 60);
}

/** Each eval or embedding-seed command in a step, from its name to the end of that command. */
function routedCommands(step: string): string[] {
  const pattern = /sage:(?:redteam|agent|quality|memory):eval|sage-chat-harness\.mjs|seed-catalog-corpus\.mjs[^;\n']*--embed/g;
  return step.split("\n").flatMap((line) => [...line.matchAll(pattern)].map((match) => line.slice(match.index).split(/;|'/)[0]));
}

function callsSageScript(step: string): boolean {
  return (step.match(new RegExp(SAGE_SCRIPT, "g")) ?? []).some((script) => !KEYLESS_SAGE_SCRIPTS.has(script));
}

const JOBS = jobs(WORKFLOW);
const MODEL_STEPS = [...JOBS].flatMap(([job, text]) =>
  steps(text)
    .filter(callsSageScript)
    .map((step) => ({ job, name: stepName(step), step })),
);

describe("Sage Evals workflow: every live model call goes through OpenRouter", () => {
  it("finds the six model-backed steps in the two eval jobs", () => {
    assert.deepEqual(
      MODEL_STEPS.map(({ job }) => job),
      ["sage-evals", "sage-evals", "sage-evals", "sage-evals", "sage-memory-eval", "sage-memory-eval"],
      MODEL_STEPS.map(({ job, name }) => `${job}: ${name}`).join("\n"),
    );
  });

  it("runs each one through the step runner, with --provider=openrouter on every eval and embedding command", () => {
    for (const { name, step } of MODEL_STEPS) {
      assert.ok(step.includes(RUNNER), `"${name}" must run through ${RUNNER}`);
      assert.match(step, /--label="[^"]+"/, `"${name}" must name itself with --label`);
      assert.ok((step.match(EVAL_COMMAND)?.length ?? 0) > 0, `"${name}" runs a Sage script that is not a known eval; route it or list it as keyless`);
      for (const command of routedCommands(step)) {
        assert.match(command, /--provider=openrouter\b/, `"${name}": ${command.trim()}`);
      }
    }
    const embedSeed = MODEL_STEPS.flatMap(({ step }) => routedCommands(step)).filter((command) => command.includes("seed-catalog-corpus"));
    assert.equal(embedSeed.length, 1, "the answer-quality step seeds embeddings once, through OpenRouter");
  });

  it("calls Google directly from nowhere: no Gemini key, provider or judge", () => {
    assert.doesNotMatch(WORKFLOW, /--provider=gemini/);
    assert.doesNotMatch(WORKFLOW, /--judge=/, "the LLM judges call Google directly with GEMINI_API_KEY");
    assert.doesNotMatch(WORKFLOW, /GEMINI_API_KEY/, "embeddings go through OpenRouter too; no step needs a Gemini key");
  });

  it("measures production's model and keeps no budget opt-in", () => {
    for (const job of new Set(MODEL_STEPS.map(({ job }) => job))) {
      const header = jobHeader(JOBS.get(job) ?? "");
      const model = header.match(/^ {6}OPENROUTER_MODEL: (\S+)$/m)?.[1];
      assert.equal(model, `google/${DEFAULT_GEMINI_MODEL}`, `${job} must measure production's model`);
      assert.match(header, /^ {6}SAGE_EVAL_SOFT_FAIL: \$\{\{ vars\.SAGE_EVAL_SOFT_FAIL \}\}$/m, job);
    }
    assert.doesNotMatch(WORKFLOW, /EVAL_BUDGET/, "the budget is each key's own spending limit, not a variable");
  });

  it("requires the secrets on this repository's own runs, and only there", () => {
    for (const job of new Set(MODEL_STEPS.map(({ job }) => job))) {
      const required = jobHeader(JOBS.get(job) ?? "").match(/^ {6}SAGE_EVAL_REQUIRED: (.+)$/m)?.[1] ?? "";
      assert.match(required, /github\.event_name != 'pull_request'/, `${job}: nightly and dispatch runs are required`);
      assert.match(required, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/, `${job}: fork PRs are not`);
    }
  });
});

describe("Sage Evals workflow: keys reach only the steps that call a model", () => {
  it("maps no secret at workflow or job level", () => {
    assert.doesNotMatch(WORKFLOW.slice(0, WORKFLOW.indexOf("\njobs:\n")), /^env:/m, "no workflow-level env");
    for (const job of ["sage-evals", "sage-memory-eval", "sage-freshness-eval"]) {
      assert.doesNotMatch(jobHeader(JOBS.get(job) ?? ""), /secrets\./, `${job} must not map a secret at job level`);
    }
  });

  it("gives each model step the OpenRouter key, and checks it before every step that embeds", () => {
    for (const { job, name, step } of MODEL_STEPS) {
      assert.ok(step.includes(`          ${OPENROUTER_SECRET}`), `"${name}" must map OPENROUTER_API_KEY in its own env`);
      assert.equal(step.includes("--needs-embeddings"), job === "sage-memory-eval", `"${name}": --needs-embeddings`);
    }
  });

  it("keeps every key away from setup steps and from the jobs that call no model", () => {
    const modelSteps = new Set(MODEL_STEPS.map(({ step }) => step));
    for (const [job, text] of JOBS) {
      for (const step of steps(text).filter((candidate) => !modelSteps.has(candidate))) {
        assert.doesNotMatch(step, /OPENROUTER_API_KEY|GEMINI_API_KEY/, `${job}: "${stepName(step)}" must hold no model key`);
      }
    }
    for (const job of ["catalog-drift", "sage-freshness-eval"]) {
      assert.doesNotMatch(JOBS.get(job) ?? "", /OPENROUTER_API_KEY|GEMINI_API_KEY/, job);
    }
  });

  it("points both eval jobs at a hermetic database, never a secret one", () => {
    for (const job of ["sage-evals", "sage-memory-eval"]) {
      const header = jobHeader(JOBS.get(job) ?? "");
      for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
        const value = header.match(new RegExp(`^ {6}${name}: (.+)$`, "m"))?.[1] ?? "";
        assert.match(value, /^"postgresql:\/\/[^@]+@localhost:5432\/[a-z_]+"$/, `${job} ${name} must be a localhost literal`);
      }
    }
  });

  it("reads the repository only, and cancels a superseded PR run", () => {
    const head = WORKFLOW.slice(0, WORKFLOW.indexOf("\njobs:\n"));
    assert.match(head, /^permissions:\n {2}contents: read$/m);
    assert.match(head, /^concurrency:\n {2}group: sage-evals-\$\{\{ github\.event\.pull_request\.number \|\| github\.run_id \}\}$/m);
    assert.match(head, /^ {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m);
  });
});

describe("Sage Evals workflow: gating and informational steps", () => {
  it("marks exactly the informational steps continue-on-error, and they say so", () => {
    for (const { name, step } of MODEL_STEPS) {
      const soft = /continue-on-error: true/.test(step);
      assert.equal(step.includes("--informational"), soft, `"${name}": --informational must match continue-on-error`);
    }
    const gating = MODEL_STEPS.filter(({ step }) => !step.includes("--informational")).map(({ name }) => name);
    assert.equal(gating.length, 4, gating.join("\n"));
  });

  it("keeps the gating thresholds and the de-identified arm", () => {
    const find = (pattern: RegExp) => MODEL_STEPS.find(({ step }) => pattern.test(step))?.step ?? "";
    const redteam = find(/sage:redteam:eval/);
    const agent = find(/sage:agent:eval/);
    const harness = find(/--families=tool,tool_watch,guardrail/);
    assert.match(redteam, /"--deidentify=Sam,Ms\. Lee"/);
    assert.match(agent, /--min-accuracy=75/);
    assert.match(agent, /"--deidentify=Sam,Ms\. Lee"/);
    for (const flag of ["--strict", "--temperature=0", "--samples=3"]) assert.ok(harness.includes(flag), flag);
  });

  it("runs the harness's own tests, keyless and time-boxed, before any model-backed step", () => {
    const all = steps(JOBS.get("sage-evals") ?? "");
    const harness = all.findIndex((step) => step.includes("scripts/lib/sage-eval-provider.test.mjs"));
    const firstModelStep = all.findIndex(callsSageScript);
    assert.ok(harness >= 0, "the sage-evals job must run scripts/lib/sage-eval-provider.test.mjs");
    assert.ok(harness < firstModelStep, "the harness tests must run before the first model-backed step");
    assert.match(all[harness], /scripts\/lib\/eval-abort\.e2e\.test\.mjs/);
    assert.match(all[harness], /timeout-minutes: \d+/);
    assert.doesNotMatch(all[harness], /secrets\.|continue-on-error/);
  });

  it("re-runs when the workflow itself changes", () => {
    const paths = WORKFLOW.slice(WORKFLOW.indexOf("pull_request:"), WORKFLOW.indexOf("\npermissions:"));
    assert.match(paths, /- "\.github\/workflows\/sage-evals\.yml"/);
  });
});
