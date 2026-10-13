#!/usr/bin/env node
/**
 * Compare models on Sage's CI-gated evals through OpenRouter.
 *
 *   OPENROUTER_API_KEY=... npm run sage:models:compare -- --models=google/gemini-3.1-flash-lite,<id>
 *   ... --evals=agent,harness        run a subset (redteam, harness, agent)
 *
 * Each eval runs as a child process with --provider=openrouter --model=<id>
 * and the same flags .github/workflows/sage-evals.yml gates on. Exit 4 from
 * an eval (model or key unavailable) is recorded as "error", not "fail". The OpenRouter
 * key's spend is read before and after each model, so every row carries its
 * cost. Exit codes from the evals: 0 pass, 1 fail, 3 not run. A "not run"
 * means credits or the key limit ran out, and it stops the whole comparison.
 *
 * A pass here means "this model passes Sage's evals on synthetic data through
 * OpenRouter". It does not approve the model for real student data. See
 * docs/runbooks/openrouter-test-bench.md.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { isMainModule } from "./bench/lib/entry.mjs";

const KEY_URL = "https://openrouter.ai/api/v1/key";
const KEY_CHECK_TIMEOUT_MS = 15_000;

/** Mirrors the flags .github/workflows/sage-evals.yml passes to each gating eval. */
export const EVALS = Object.freeze([
  { id: "redteam", script: "scripts/sage-redteam-eval.mjs", args: ["--deidentify=Sam,Ms. Lee"] },
  {
    id: "harness",
    script: "scripts/sage-chat-harness.mjs",
    args: ["--strict", "--families=tool,tool_watch,guardrail", "--temperature=0", "--samples=3"],
  },
  { id: "agent", script: "scripts/sage-agent-eval.mjs", args: ["--min-accuracy=75", "--deidentify=Sam,Ms. Lee"] },
]);
// sage-quality-eval is left out on purpose: without its Gemini judge it has no
// pass criterion and always exits 0, so it would read as "pass" for any model.

function flagValue(argv, name) {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}

function csv(value) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function parseArgs(argv) {
  const models = csv(flagValue(argv, "models"));
  if (models.length === 0) throw new Error("Pass --models=<id>[,<id>] with OpenRouter model ids.");
  const requested = flagValue(argv, "evals");
  const ids = requested === null ? EVALS.map((e) => e.id) : csv(requested);
  const unknown = ids.filter((id) => !EVALS.some((e) => e.id === id));
  if (unknown.length > 0) {
    throw new Error(`Unknown --evals: ${unknown.join(", ")}. Known: ${EVALS.map((e) => e.id).join(", ")}.`);
  }
  return { models, evals: EVALS.filter((e) => ids.includes(e.id)) };
}

export function classifyExit(code) {
  if (code === 0) return "pass";
  if (code === 1) return "fail";
  if (code === 3) return "not_run";
  return "error";
}

export function costDelta(before, after) {
  if (typeof before !== "number" || typeof after !== "number") return null;
  return Number((after - before).toFixed(6));
}

export async function readKeyUsage(apiKey, fetchImpl = fetch) {
  const response = await fetchImpl(KEY_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OpenRouter key check failed (${response.status})`);
  const json = await response.json();
  const usage = json?.data?.usage;
  if (typeof usage !== "number") throw new Error("OpenRouter key check returned no usage figure");
  return usage;
}

export function runEvalProcess(evalSpec, model, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["tsx", evalSpec.script, "--provider=openrouter", `--model=${model}`, ...evalSpec.args],
      { stdio: "inherit", env },
    );
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export async function compareModels({ models, evals, runEval, readUsage }) {
  const rows = [];
  for (const model of models) {
    const before = await readUsage();
    const outcomes = [];
    for (const evalSpec of evals) {
      const outcome = classifyExit(await runEval(evalSpec, model));
      outcomes.push({ eval: evalSpec.id, outcome });
      if (outcome === "not_run") break;
    }
    const after = await readUsage();
    rows.push({ model, outcomes, costUsd: costDelta(before, after) });
    if (outcomes.some((entry) => entry.outcome === "not_run")) return { rows, stoppedEarly: true };
  }
  return { rows, stoppedEarly: false };
}

export function formatTable(rows, evals) {
  const header = ["model", ...evals.map((e) => e.id), "cost_usd"];
  const body = rows.map((row) => [
    row.model,
    ...evals.map((e) => row.outcomes.find((entry) => entry.eval === e.id)?.outcome ?? "-"),
    row.costUsd === null ? "?" : row.costUsd.toFixed(4),
  ]);
  const widths = header.map((cell, i) => Math.max(cell.length, ...body.map((line) => line[i].length)));
  const render = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();
  return [render(header), render(widths.map((width) => "-".repeat(width))), ...body.map(render)].join("\n");
}

function writeReport(result, evals) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join("reports", "model-compare", `${stamp}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  const payload = { generatedAt: new Date().toISOString(), evals: evals.map((e) => e.id), ...result };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

async function main() {
  const { models, evals } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing: required for sage:models:compare.");
  const result = await compareModels({
    models,
    evals,
    runEval: (evalSpec, model) => runEvalProcess(evalSpec, model),
    readUsage: () => readKeyUsage(apiKey),
  });
  console.log(`\n${formatTable(result.rows, evals)}`);
  if (result.stoppedEarly) console.log("\nStopped early: an eval reported not run (OpenRouter credits or key limit).");
  console.log(`Wrote ${writeReport(result, evals)}`);
  process.exitCode = result.stoppedEarly ? 3 : 0;
}

if (isMainModule(import.meta.url, process.argv)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
