/**
 * sage-model-bakeoff — score N local models against each VisionQuest AI ROLE.
 *
 * WHY THIS EXISTS
 * ---------------
 * VisionQuest asks a local model to do four genuinely different jobs (see
 * src/lib/ai/roles.ts). Until this script, only one of them — coaching chat —
 * had any live-model instrument at all, and none of the instruments could take
 * a model name as an argument: they all read OLLAMA_MODEL from the environment,
 * so comparing two models meant mutating global state between arms and
 * hand-collecting stdout. Three of the four roles had never been measured
 * against any model.
 *
 * This runs every role's fixtures against every candidate model and prints one
 * comparison matrix, so "which model for which role" becomes a reading of
 * numbers rather than an argument about model cards.
 *
 * SCORING IS DETERMINISTIC ON PURPOSE
 * -----------------------------------
 * No LLM judge anywhere. Every check is JSON validity, schema conformance,
 * gold-substring presence, word-count bands, or Flesch-Kincaid grade computed
 * by the same helper production uses. A judge would make results incomparable
 * across runs and would need a cloud key, which defeats the point of
 * benchmarking the FERPA-local path.
 *
 * PROMPTS COME FROM PRODUCTION
 * ----------------------------
 * The memory, classroom, resume and tool-registry prompts are imported from
 * src/ at runtime rather than copied into the fixture file, so the bake-off
 * measures what the app actually sends. Fixtures carry only inputs and gold.
 *
 * EVICTION BETWEEN ARMS IS THE DEFAULT, NOT AN OPTION
 * --------------------------------------------------
 * Every model this script touches stays resident afterwards — for the host's
 * OLLAMA_KEEP_ALIVE window, since the /v1 surface the provider prefers ignores
 * per-request keep_alive. On 2026-07-27 a resident large model starved the
 * next arm into the 300s provider timeout and produced a confidently WRONG
 * conclusion that only reversed once the models were evicted between runs. So
 * each arm explicitly unloads every other candidate through the native
 * endpoint (the one that honors keep_alive: 0) and warms its own model before
 * the clock starts. Pass --no-evict only to measure co-residency deliberately.
 *
 * USAGE
 * -----
 *   npx tsx scripts/sage-model-bakeoff.mjs --models=gemma4:26b-a4b-it-qat,gemma4:12b,gemma4:e4b
 *   npx tsx scripts/sage-model-bakeoff.mjs --models=a,b --roles=extract,document --repeats=5
 *
 * OPTIONS
 *   --models=<tag,tag,...>   REQUIRED. Ollama model tags to compare.
 *   --roles=<role,...>       Default: all four (chat, extract, document, draft).
 *   --url=<base>             Default: env OLLAMA_URL, else http://localhost:11434
 *   --repeats=<n>            Runs per case, default 3. Local models are not
 *                            deterministic at temperature 0; one draw is noise.
 *   --max-output-tokens=<n>  Output cap for every arm, default 768 (the
 *                            production free-text default). Raise it to see
 *                            which roles are cap-bound rather than model-bound.
 *   --num-ctx=<n>            KV-cache window, default 8192 (production default).
 *   --fixture=<path>         Default config/sage-model-bakeoff.json
 *   --json-out=<path>        Write the full per-run result array as JSON.
 *   --no-evict               Do not evict other candidates between arms.
 *   --warmup-only            Pull/warm each model and exit — useful to confirm
 *                            every candidate is actually installed first.
 *
 * EXIT CODE
 *   0 when every arm produced results. 1 on a preflight failure (server
 *   unreachable, model not installed) or if every case of some role failed for
 *   every model, which means the fixtures — not the models — need attention.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { percentile } from "./lib/percentile.mjs";

const DEFAULT_FIXTURE = "config/sage-model-bakeoff.json";
const DEFAULT_URL = "http://localhost:11434";
const ALL_ROLES = ["chat", "extract", "document", "draft"];

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const get = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit === undefined ? fallback : hit.slice(name.length + 3);
  };
  const getInt = (name, fallback) => {
    const raw = get(name, null);
    if (raw === null) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer, got "${raw}"`);
    return parsed;
  };
  const list = (raw) =>
    String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const modelsRaw = get("models", "");
  const models = list(modelsRaw);
  if (models.length === 0) {
    throw new Error("--models=<tag,tag,...> is required. Example: --models=gemma4:12b,gemma4:e4b");
  }
  if (new Set(models).size !== models.length) {
    throw new Error("--models contains a duplicate tag; each arm must be distinct.");
  }

  const roles = get("roles", null) ? list(get("roles", "")) : [...ALL_ROLES];
  if (roles.length === 0) {
    // `--roles=" "` filters to nothing. Without this the run prints an empty
    // matrix and exits 0, indistinguishable from a completed comparison.
    throw new Error('--roles was given but named no role. Omit it to run all four.');
  }
  for (const role of roles) {
    if (!ALL_ROLES.includes(role)) {
      throw new Error(`Unknown role "${role}" — expected one of ${ALL_ROLES.join(", ")}.`);
    }
  }

  const repeats = getInt("repeats", 3);
  if (repeats < 1) throw new Error("--repeats must be >= 1");

  return {
    models,
    roles,
    repeats,
    url: (get("url", process.env.OLLAMA_URL || DEFAULT_URL) || DEFAULT_URL).replace(/\/+$/, ""),
    maxOutputTokens: getInt("max-output-tokens", 768),
    // Production's structured path defaults to 512, NOT the free-text 768.
    // Benchmarking the strict-JSON roles at 768 would score them with 50% more
    // headroom than they get in production, so a model could pass `document`
    // here and truncate in the app. An explicit --max-output-tokens applies to
    // both, which is how you find out whether a role is cap-bound.
    structuredMaxOutputTokens: getInt("max-output-tokens", 512),
    numCtx: getInt("num-ctx", 8192),
    fixturePath: get("fixture", DEFAULT_FIXTURE),
    jsonOut: get("json-out", null),
    evict: !argv.includes("--no-evict"),
    warmupOnly: argv.includes("--warmup-only"),
  };
}

// ---------------------------------------------------------------------------
// ollama control-plane helpers (residency)
// ---------------------------------------------------------------------------

async function listInstalledModels(url) {
  let response;
  try {
    response = await fetch(`${url}/api/tags`, { method: "GET" });
  } catch (err) {
    throw new PreflightError(
      `Cannot reach Ollama at ${url} (${err?.message ?? err}).\n` +
        `Start it with \`ollama serve\`, or pass --url=<base> if it lives elsewhere.`,
    );
  }
  if (!response.ok) {
    throw new PreflightError(`Ollama /api/tags returned ${response.status} at ${url}`);
  }
  const data = await response.json();
  return (data.models ?? []).map((m) => m.name);
}

/** A setup problem the operator can fix — reported as one line, not a stack. */
export class PreflightError extends Error {}

async function listResidentModels(url) {
  try {
    const response = await fetch(`${url}/api/ps`, { method: "GET" });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/** keep_alive 0 unloads immediately. The empty-messages form is a no-op turn. */
async function evictModel(url, model) {
  try {
    await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
    });
  } catch {
    // Eviction is best-effort; a failure here shows up as a slow arm, and the
    // residency line printed per arm makes that visible rather than silent.
  }
}

async function warmModel(url, model, numCtx) {
  const started = Date.now();
  const response = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with OK only." }],
      stream: false,
      options: { num_ctx: numCtx, num_predict: 8 },
      keep_alive: "10m",
    }),
  });
  if (!response.ok) {
    throw new Error(`Warmup for ${model} returned ${response.status}`);
  }
  await response.json();
  return Date.now() - started;
}

// ---------------------------------------------------------------------------
// scoring primitives — all deterministic
// ---------------------------------------------------------------------------

/** Presence check that ignores case, since gold facts are proper nouns. */
export function containsAny(haystack, needles) {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(String(needle).toLowerCase()));
}

/**
 * A JSON reply that stops mid-structure is the signature of hitting the output
 * cap. Distinguishing it from "the model emitted prose" matters: one is a
 * budget problem the operator can fix with a config value, the other is a
 * model problem no budget will fix.
 */
export function looksTruncated(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const opens = (trimmed.match(/[{[]/g) ?? []).length;
  const closes = (trimmed.match(/[}\]]/g) ?? []).length;
  return opens > closes;
}

/**
 * Walk a dotted field path ("resume.contact") through a parsed object.
 *
 * Production contracts nest: the resume parser returns
 * `{resume: {...}, improvements: [], notes: ""}`, so a fixture asserting a
 * bare "contact" would fail for every model and read as a model verdict.
 * Returns undefined when any segment is missing.
 */
export function resolveFieldPath(value, path) {
  return String(path)
    .split(".")
    .reduce(
      (current, segment) =>
        current !== null && typeof current === "object" && segment in current
          ? current[segment]
          : undefined,
      value,
    );
}

export function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Degenerate repetition — the same 6-word window appearing many times — is how
 * a too-small model fails a long drafting task. It reads as fluent text and
 * passes every length check, so it needs its own detector.
 */
export function repetitionRatio(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 24) return 0;
  const windows = [];
  for (let i = 0; i + 6 <= words.length; i++) windows.push(words.slice(i, i + 6).join(" "));
  const unique = new Set(windows);
  return 1 - unique.size / windows.length;
}

// ---------------------------------------------------------------------------
// role runners
// ---------------------------------------------------------------------------

/**
 * Each runner returns { pass, checks, chars, detail } for ONE draw. `checks` is
 * a per-criterion map so the report can say WHICH property a model failed
 * rather than only that it scored low.
 */

export async function runChatCase({ provider, toolDeclarations, assessReadability, maxGrade }, testCase) {
  const checks = {};
  const calls = [];
  let text = "";

  const noopToolHandler = async () => ({
    response: { ok: true },
    summary: "(bake-off stub — not executed)",
    status: "success",
  });

  const events = provider.streamWithTools(
    CHAT_SYSTEM_PROMPT,
    [{ role: "user", content: testCase.message }],
    toolDeclarations,
    noopToolHandler,
    { maxHops: 1 },
  );
  for await (const event of events) {
    if (event.kind === "tool_call") calls.push(event.name);
    if (event.kind === "text") text += event.text;
  }

  const picked = calls[0] ?? null;

  if (testCase.expectTool) {
    const acceptable = testCase.acceptableTools ?? [testCase.expectTool];
    checks.toolSelection = picked !== null && acceptable.includes(picked);
  } else if (testCase.mustNotCallAny) {
    checks.noOverTrigger = calls.length === 0;
  }

  // An empty turn with no tool call is the failure this repo has hit three
  // separate ways. Count it explicitly rather than letting it pass as "no
  // tool expected, no text needed".
  if (!testCase.expectTool) {
    checks.visibleContent = text.trim().length > 0;
  }

  if (testCase.readability && text.trim()) {
    const assessment = assessReadability(text);
    checks.readability = !assessment.scorable || assessment.grade <= maxGrade;
    return {
      pass: Object.values(checks).every(Boolean),
      checks,
      chars: text.length,
      detail: { picked, grade: assessment.scorable ? Number(assessment.grade.toFixed(1)) : null },
    };
  }

  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    chars: text.length,
    detail: { picked },
  };
}

export async function runStructuredCase({ provider, prompts, parseModelJson }, testCase, fixture) {
  const checks = {};
  let systemPrompt;
  let messages;

  if (testCase.prompt === "memory") {
    systemPrompt = prompts.memory;
    messages = testCase.messages;
  } else if (testCase.prompt === "classroom") {
    systemPrompt = prompts.classroom;
    messages = testCase.messages;
  } else if (testCase.prompt === "resume") {
    systemPrompt = prompts.resume;
    const document = fixture.documentFixtures?.[testCase.documentFixture];
    if (!document) {
      throw new Error(`Case ${testCase.id} references missing documentFixture "${testCase.documentFixture}"`);
    }
    messages = [{ role: "user", content: document }];
  } else {
    throw new Error(`Case ${testCase.id} has unknown prompt "${testCase.prompt}"`);
  }

  const raw = await provider.generateStructuredResponse(systemPrompt, messages);

  checks.visibleContent = raw.trim().length > 0;
  const parsed = parseModelJson(raw);
  checks.parsesAsJson = parsed !== null;
  const truncated = looksTruncated(raw);

  if (parsed !== null) {
    if (testCase.expectJsonArrayOf) {
      // json_object mode cannot emit a bare array, so production accepts both
      // the array and the {key: [...]} wrapper. Score the same contract.
      const items = Array.isArray(parsed) ? parsed : parsed?.[testCase.expectJsonArrayOf];
      checks.arrayShape = Array.isArray(items);
      if (Array.isArray(items)) {
        if (typeof testCase.expectMinItems === "number") {
          checks.itemCount = items.length >= testCase.expectMinItems;
        }
        if (typeof testCase.expectMaxItems === "number") {
          checks.noOverExtraction = items.length <= testCase.expectMaxItems;
        }
      }
    }
    if (testCase.expectJsonObject) {
      checks.objectShape = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    }
    if (testCase.expectFields) {
      checks.requiredFields = testCase.expectFields.every(
        (field) => resolveFieldPath(parsed, field) !== undefined,
      );
    }
    if (testCase.expectFieldValues) {
      checks.fieldValues = Object.entries(testCase.expectFieldValues).every(
        ([field, want]) => resolveFieldPath(parsed, field) === want,
      );
    }
  }

  if (testCase.mustContainAny) {
    checks.groundedFacts = containsAny(raw, testCase.mustContainAny);
  }

  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    chars: raw.length,
    detail: { truncated },
  };
}

export async function runDraftCase({ provider, assessReadability, maxGrade }, testCase) {
  const checks = {};
  const text = await provider.generateResponse(testCase.systemPrompt, testCase.messages);

  checks.visibleContent = text.trim().length > 0;

  const words = wordCount(text);
  if (typeof testCase.minWords === "number") checks.minLength = words >= testCase.minWords;
  if (typeof testCase.maxWords === "number") checks.maxLength = words <= testCase.maxWords;
  if (testCase.mustContainAny) checks.groundedFacts = containsAny(text, testCase.mustContainAny);
  if (testCase.mustNotContain) {
    checks.noPlaceholders = !containsAny(text, testCase.mustNotContain);
  }

  const repetition = repetitionRatio(text);
  checks.notDegenerate = repetition < 0.25;

  let grade = null;
  if (testCase.readability && text.trim()) {
    const assessment = assessReadability(text);
    grade = assessment.scorable ? Number(assessment.grade.toFixed(1)) : null;
    checks.readability = !assessment.scorable || assessment.grade <= maxGrade;
  }

  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    chars: text.length,
    detail: { words, grade, repetition: Number(repetition.toFixed(2)) },
  };
}

export const CHAT_SYSTEM_PROMPT = `You are Sage, the AI coach for SPOKES workforce-development students.
You can call tools to act for the student. Use a tool when the student's request maps to one; answer in plain text when none applies.
For consequential actions (filing forms, changing goals) the system will ask the user to confirm — just make the appropriate tool call.
Write at a 6th-grade reading level. Be direct, warm, and practical.`;

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    throw new PreflightError(err?.message ?? String(err));
  }

  const fixture = JSON.parse(
    readFileSync(path.resolve(process.cwd(), options.fixturePath), "utf8"),
  );

  console.log(`Ollama: ${options.url}`);
  const installed = await listInstalledModels(options.url);
  const missing = options.models.filter((model) => !installed.includes(model));
  if (missing.length > 0) {
    console.error(`\nNot installed on this server: ${missing.join(", ")}`);
    console.error(`Pull them first:  ${missing.map((m) => `ollama pull ${m}`).join(" && ")}`);
    console.error(`\nInstalled: ${installed.join(", ") || "(none)"}`);
    process.exitCode = 1;
    return;
  }

  if (options.warmupOnly) {
    for (const model of options.models) {
      const ms = await warmModel(options.url, model, options.numCtx);
      console.log(`  warmed ${model} in ${(ms / 1000).toFixed(1)}s`);
    }
    return;
  }

  // Production modules, imported once. Prompts and the tool registry come from
  // src/ so the bake-off measures what the app actually sends.
  const { OllamaProvider } = await import("../src/lib/ai/ollama-provider.ts");
  const { getEnabledTools } = await import("../src/lib/sage/agent/tools.ts");
  const { assessReadability, PLAIN_LANGUAGE_MAX_GRADE } = await import(
    "../src/lib/sage/readability.ts"
  );
  const { EXTRACTION_PROMPT, parseModelJson } = await import(
    "../src/lib/sage/memory/extract.ts"
  );
  const { DETECTION_PROMPT } = await import("../src/lib/sage/classroom-confirmation.ts");
  const { EXTRACT_PROMPT } = await import("../src/lib/resume-extract.ts");

  const prompts = {
    memory: EXTRACTION_PROMPT,
    classroom: DETECTION_PROMPT,
    resume: EXTRACT_PROMPT,
  };
  const toolDeclarations = getEnabledTools("student").map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  const totalCases = options.roles.reduce(
    (sum, role) => sum + (fixture.roles[role]?.cases?.length ?? 0),
    0,
  );
  console.log(
    `Bake-off: ${options.models.length} models x ${options.roles.length} roles ` +
      `(${totalCases} cases) x ${options.repeats} repeats = ` +
      `${options.models.length * totalCases * options.repeats} model calls\n`,
  );
  console.log(
    `Caps: free-text ${options.maxOutputTokens} tok, JSON mode ` +
      `${options.structuredMaxOutputTokens} tok (production defaults), ` +
      `num_ctx=${options.numCtx}, eviction ${options.evict ? "ON" : "OFF"}\n`,
  );

  /** @type {Array<object>} */
  const runs = [];

  for (const model of options.models) {
    if (options.evict) {
      for (const other of options.models) {
        if (other !== model) await evictModel(options.url, other);
      }
    }
    const resident = await listResidentModels(options.url);
    const warmMs = await warmModel(options.url, model, options.numCtx);
    console.log(
      `\n=== ${model} ===  (warm ${(warmMs / 1000).toFixed(1)}s; resident before warm: ` +
        `${resident.filter((r) => r !== model).join(", ") || "none"})`,
    );

    const provider = new OllamaProvider(options.url, model, {
      authMode: "none",
      apiKey: process.env.AI_PROVIDER_API_KEY || process.env.OLLAMA_API_KEY || null,
      numCtx: options.numCtx,
      maxOutputTokens: options.maxOutputTokens,
      structuredMaxOutputTokens: options.structuredMaxOutputTokens,
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

    for (const role of options.roles) {
      const cases = fixture.roles[role]?.cases ?? [];
      for (const testCase of cases) {
        for (let draw = 1; draw <= options.repeats; draw++) {
          const started = Date.now();
          let outcome;
          try {
            if (role === "chat") outcome = await runChatCase(context, testCase);
            else if (role === "draft") outcome = await runDraftCase(context, testCase);
            else outcome = await runStructuredCase(context, testCase, fixture);
          } catch (err) {
            outcome = {
              pass: false,
              checks: { providerError: false },
              chars: 0,
              detail: { error: err?.message ?? String(err) },
            };
          }
          const durationMs = Date.now() - started;
          runs.push({ model, role, caseId: testCase.id, draw, durationMs, ...outcome });
          process.stdout.write(outcome.pass ? "." : "x");
        }
      }
    }
    process.stdout.write("\n");
  }

  // Written BEFORE the report so an hour of model calls is never lost to a
  // formatting bug, and with the directory created because the documented
  // invocation writes to reports/, which is not in the repo.
  if (options.jsonOut) {
    const outPath = path.resolve(process.cwd(), options.jsonOut);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(runs, null, 2));
    console.log(`\nFull results written to ${options.jsonOut}`);
  }

  report(runs, options);

  // A role that failed every case for every model is a fixture problem, not a
  // model verdict. Say so loudly rather than reporting a bake-off "winner" of
  // 0% vs 0%.
  const brokenRoles = options.roles.filter((role) => {
    const roleRuns = runs.filter((run) => run.role === role);
    // `[].every()` is true, so a role with NO runs would otherwise be reported
    // as "no model passed any case" — a fixture-loading problem dressed up as
    // a model verdict.
    return roleRuns.length > 0 && roleRuns.every((run) => !run.pass);
  });
  const emptyRoles = options.roles.filter(
    (role) => runs.filter((run) => run.role === role).length === 0,
  );
  if (emptyRoles.length > 0) {
    console.error(
      `\nNo cases ran for: ${emptyRoles.join(", ")}. The fixture file has no cases for ` +
        `${emptyRoles.length === 1 ? "that role" : "those roles"} — nothing was measured.`,
    );
    process.exitCode = 1;
  }
  if (brokenRoles.length > 0) {
    console.error(
      `\nNo model passed ANY case for: ${brokenRoles.join(", ")}. ` +
        `That is a fixture or connectivity problem, not a model ranking — do not read it as a result.`,
    );
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function report(runs, options) {
  console.log("\n\n================ ROLE x MODEL ================\n");

  for (const role of options.roles) {
    const roleRuns = runs.filter((run) => run.role === role);
    if (roleRuns.length === 0) continue;

    console.log(`--- ${role} ---`);
    const rows = options.models.map((model) => {
      const modelRuns = roleRuns.filter((run) => run.model === model);
      const passed = modelRuns.filter((run) => run.pass).length;
      const durations = modelRuns.map((run) => run.durationMs).sort((a, b) => a - b);
      const truncated = modelRuns.filter((run) => run.detail?.truncated).length;
      const errored = modelRuns.filter((run) => run.detail?.error).length;
      return {
        model,
        passPct: modelRuns.length === 0 ? 0 : (passed / modelRuns.length) * 100,
        passed,
        total: modelRuns.length,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        truncated,
        errored,
      };
    });

    const width = Math.max(...rows.map((row) => row.model.length), 5);
    console.log(
      `${"model".padEnd(width)}  ${"pass".padStart(8)}  ${"p50".padStart(8)}  ` +
        `${"p95".padStart(8)}  ${"trunc".padStart(5)}  ${"err".padStart(4)}`,
    );
    for (const row of rows) {
      console.log(
        `${row.model.padEnd(width)}  ` +
          `${`${row.passed}/${row.total}`.padStart(8)}  ` +
          `${`${(row.p50 / 1000).toFixed(1)}s`.padStart(8)}  ` +
          `${`${(row.p95 / 1000).toFixed(1)}s`.padStart(8)}  ` +
          `${String(row.truncated).padStart(5)}  ${String(row.errored).padStart(4)}`,
      );
    }

    // Which specific property each model failed — the number alone does not
    // tell an operator whether to change the model or raise a cap.
    const failedChecks = new Map();
    for (const run of roleRuns.filter((r) => !r.pass)) {
      for (const [check, ok] of Object.entries(run.checks ?? {})) {
        if (ok) continue;
        const key = `${run.model} :: ${check}`;
        failedChecks.set(key, (failedChecks.get(key) ?? 0) + 1);
      }
    }
    if (failedChecks.size > 0) {
      console.log("  failures by property:");
      for (const [key, count] of [...failedChecks.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${key} x${count}`);
      }
    }

    // The error text lives only in --json-out otherwise, and an operator
    // reading "err 3" has no idea whether that was a 404 or a timeout.
    const errorMessages = new Map();
    for (const run of roleRuns) {
      const message = run.detail?.error;
      if (!message) continue;
      const key = `${run.model} :: ${message}`;
      errorMessages.set(key, (errorMessages.get(key) ?? 0) + 1);
    }
    if (errorMessages.size > 0) {
      console.log("  provider errors:");
      for (const [key, count] of [...errorMessages.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${key} x${count}`);
      }
    }

    const best = [...rows].sort(
      (a, b) => b.passPct - a.passPct || a.p50 - b.p50,
    )[0];
    if (!best || best.passPct === 0) {
      // The "=>" line is the one thing in this report that looks like a
      // decision. Printing it under an all-failing role hands the operator a
      // recommendation drawn from a run where nothing worked.
      console.log("  => no recommendation: no model passed a single case for this role\n");
      continue;
    }
    const tied = rows.filter((row) => row.passPct === best.passPct);
    console.log(
      tied.length > 1
        ? `  => ${best.model} (fastest of ${tied.length} tied at ${best.passPct.toFixed(0)}%)\n`
        : `  => ${best.model} (${best.passPct.toFixed(0)}%, p50 ${(best.p50 / 1000).toFixed(1)}s)\n`,
    );
  }

  console.log("=============================================");
  console.log(
    "Reminder: a per-role pick is only worth its memory cost if the roles genuinely differ.\n" +
      "Each DISTINCT model you deploy is a standing claim on unified memory — the number of\n" +
      "distinct models is the budget, not the number of roles. Pointing three roles at one\n" +
      "model is a legitimate and often correct outcome of this bake-off.",
  );
}

// Only auto-run when executed directly — importing this module for its pure
// scoring helpers (contract tests) must never start a live bake-off.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    if (err instanceof PreflightError || err?.name === "PreflightError") {
      console.error(`\n${err.message}`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  });
}
