/**
 * bench suite: model-bakeoff (config/benchmarks/model-bakeoff.json)
 *
 * Manual tier, artifact committed. Wraps scripts/sage-model-bakeoff.mjs's
 * exported per-case runners (runChatCase/runStructuredCase/runDraftCase,
 * exported already) plus listInstalledModels/warmModel (exported this
 * session, no CLI behavior change) — scored against the ONE candidate model
 * configured per role via env, not the standalone tool's N-model comparison
 * matrix.
 *
 * "Record the host" rule (design §6, this agent's brief): refuses to run at
 * all unless OLLAMA_HOST answers /api/tags, and records `ollama --version`,
 * chip/memory (node:os), OLLAMA_NUM_PARALLEL, and OLLAMA_KEEP_ALIVE into
 * every metric's `details.host` — every prior local-model number in this
 * repo's history has an unrecorded host, which is why they contradict each
 * other (.claude/MEMORY.md, 2026-08-21 Open Items).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evictModel,
  listInstalledModels,
  runChatCase,
  runDraftCase,
  runStructuredCase,
  warmModel,
} from "../../sage-model-bakeoff.mjs";
import { isMainModule, runSelfTest } from "./ops-shared.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ROLES = ["chat", "extract", "document", "draft"];
const DEFAULT_URL = "http://localhost:11434";
// Production free-text / structured defaults (matches src/lib/ai/ollama-provider.ts
// and the standalone bake-off's own --max-output-tokens / --num-ctx defaults).
const DEFAULT_MAX_OUTPUT_TOKENS = 768;
const DEFAULT_STRUCTURED_MAX_OUTPUT_TOKENS = 512;
const DEFAULT_NUM_CTX = 8192;

/** GET /api/tags — the literal "OLLAMA_HOST answers" check this suite refuses to skip. */
async function pingOllama(url) {
  try {
    const response = await fetch(`${url}/api/tags`, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * ollama --version, chip/memory, and the two env knobs this repo has
 * repeatedly gotten wrong by not recording (OLLAMA_NUM_PARALLEL,
 * OLLAMA_KEEP_ALIVE). Never throws: an unreadable field is recorded as
 * null/(unset), not fatal — the CLI binary can be absent from PATH even
 * when the HTTP server it talks to is reachable and healthy.
 */
export function recordHost() {
  let ollamaVersion = null;
  try {
    const result = spawnSync("ollama", ["--version"], { encoding: "utf8" });
    if (result.status === 0 && result.stdout) ollamaVersion = result.stdout.trim();
  } catch {
    // ollama CLI not on PATH — not fatal, just unrecorded.
  }
  const cpus = os.cpus();
  return {
    ollamaVersion,
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: cpus[0]?.model ?? null,
    cpuCount: cpus.length,
    memGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    OLLAMA_NUM_PARALLEL: process.env.OLLAMA_NUM_PARALLEL ?? "(unset)",
    OLLAMA_KEEP_ALIVE: process.env.OLLAMA_KEEP_ALIVE ?? "(unset)",
  };
}

/** Per-role env resolution: BENCH_BAKEOFF_MODEL_<ROLE> first, then the shared BENCH_BAKEOFF_MODEL, else null. */
export function resolveRoleModel(role, env = process.env) {
  return env[`BENCH_BAKEOFF_MODEL_${role.toUpperCase()}`] || env.BENCH_BAKEOFF_MODEL || null;
}

/**
 * Pure pass-rate reduction, tested without Ollama in model-bakeoff.test.mjs:
 * turns a role's per-case outcomes into its `<role>_score` metric. A role
 * with no resolved model, or zero cases, is null (not 0) — there is nothing
 * to score, and a false 0% would misreport as "every case failed."
 *
 * @param {string} role
 * @param {{ model: string, results: Array<{ pass: boolean }> } | null} roleRun
 * @param {string | null} skipReason
 * @param {object} host
 * @param {string} artifactPath
 */
export function roleMetric(role, roleRun, skipReason, host, artifactPath) {
  if (!roleRun) {
    return { id: `${role}_score`, value: null, details: { host, artifactPath, skipped: skipReason } };
  }
  const total = roleRun.results.length;
  const passed = roleRun.results.filter((r) => r.pass).length;
  return {
    id: `${role}_score`,
    value: total === 0 ? null : passed / total,
    n: total,
    details: { host, artifactPath, model: roleRun.model, passed, total },
  };
}

/** @param {object} ctx @returns {Promise<{ metrics: Array<object> }>} */
export async function run(ctx) {
  const url = ctx.env.ollamaHost || DEFAULT_URL;
  const answers = await pingOllama(url);
  if (!answers) {
    throw new Error(`model-bakeoff requires ollama: OLLAMA_HOST (${url}) did not answer /api/tags.`);
  }

  const host = recordHost();
  const date = new Date().toISOString().slice(0, 10);
  const artifactPath = `reports/benchmarks/bakeoff/${date}.json`;

  const fixture = ctx.fixture;
  const installed = await listInstalledModels(url);

  // Production modules, imported once — same discipline as the standalone
  // bake-off: prompts and the tool registry come from src/ so this suite
  // measures what the app actually sends, never a copy.
  const { OllamaProvider } = await import("../../../src/lib/ai/ollama-provider.ts");
  const { getEnabledTools } = await import("../../../src/lib/sage/agent/tools.ts");
  const { assessReadability, PLAIN_LANGUAGE_MAX_GRADE } = await import(
    "../../../src/lib/sage/readability.ts"
  );
  const { EXTRACTION_PROMPT, parseModelJson } = await import("../../../src/lib/sage/memory/extract.ts");
  const { DETECTION_PROMPT } = await import("../../../src/lib/sage/classroom-confirmation.ts");
  const { EXTRACT_PROMPT } = await import("../../../src/lib/resume-extract.ts");

  const prompts = { memory: EXTRACTION_PROMPT, classroom: DETECTION_PROMPT, resume: EXTRACT_PROMPT };
  const toolDeclarations = getEnabledTools("student").map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  const runsByRole = {};
  const skippedRoles = {};
  const modelsUsed = new Set();

  for (const role of ROLES) {
    const model = resolveRoleModel(role);
    if (!model) {
      skippedRoles[role] = "no candidate model configured (set BENCH_BAKEOFF_MODEL_<ROLE> or BENCH_BAKEOFF_MODEL)";
      continue;
    }
    if (!installed.includes(model)) {
      skippedRoles[role] = `model "${model}" is not installed on this Ollama server (installed: ${installed.join(", ") || "none"})`;
      continue;
    }
    modelsUsed.add(model);
  }

  // Evict every OTHER candidate before warming each one, per the standing
  // "evict between arms" rule (2026-07-27) — a resident large model starves
  // the next one into the provider's timeout and produces a confidently
  // wrong score, not a missing one.
  for (const role of ROLES) {
    const model = resolveRoleModel(role);
    if (!model || skippedRoles[role]) continue;

    for (const other of modelsUsed) {
      if (other !== model) await evictModel(url, other);
    }
    await warmModel(url, model, DEFAULT_NUM_CTX);

    const provider = new OllamaProvider(url, model, {
      authMode: "none",
      apiKey: process.env.AI_PROVIDER_API_KEY || process.env.OLLAMA_API_KEY || null,
      numCtx: DEFAULT_NUM_CTX,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      structuredMaxOutputTokens: DEFAULT_STRUCTURED_MAX_OUTPUT_TOKENS,
      reasoning: false,
    });
    const context = {
      provider,
      toolDeclarations,
      prompts,
      parseModelJson,
      assessReadability,
      maxGrade: PLAIN_LANGUAGE_MAX_GRADE,
    };

    const cases = fixture.roles?.[role]?.cases ?? [];
    const results = [];
    for (const testCase of cases) {
      let outcome;
      try {
        if (role === "chat") outcome = await runChatCase(context, testCase);
        else if (role === "draft") outcome = await runDraftCase(context, testCase);
        else outcome = await runStructuredCase(context, testCase, fixture);
      } catch (err) {
        outcome = { pass: false, detail: { error: err?.message ?? String(err) } };
      }
      results.push({ caseId: testCase.id, ...outcome });
    }
    runsByRole[role] = { model, results };
  }

  const metrics = ROLES.map((role) =>
    roleMetric(role, runsByRole[role] ?? null, skippedRoles[role] ?? null, host, artifactPath)
  );

  // Written before returning, matching the standalone bake-off's own
  // "an hour of model calls should never be lost to a downstream formatting
  // bug" discipline.
  const absoluteArtifactPath = path.join(REPO_ROOT, artifactPath);
  mkdirSync(path.dirname(absoluteArtifactPath), { recursive: true });
  writeFileSync(absoluteArtifactPath, JSON.stringify({ generatedAt: new Date().toISOString(), host, runsByRole, skippedRoles }, null, 2));

  return { metrics };
}

async function checkRequires(ctx) {
  const url = ctx.env.ollamaHost || DEFAULT_URL;
  const answers = await pingOllama(url);
  if (!answers) {
    return `OLLAMA_HOST (${url}) did not answer /api/tags — is Ollama running?`;
  }
  return null;
}

if (isMainModule(import.meta.url) && process.argv.includes("--self-test")) {
  runSelfTest({
    suiteName: "model-bakeoff",
    configPath: "config/benchmarks/model-bakeoff.json",
    run,
    checkRequires,
  }).then((code) => {
    process.exitCode = code;
  });
}
