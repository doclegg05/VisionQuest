import assert from "node:assert/strict";
import { afterEach, before, beforeEach, mock, test } from "node:test";
import { assertCloudInferenceAllowed, assertLocalDemoTarget, isDemoLocalOnlyRequired } from "./demo-local-only";

const values = new Map<string, string>();
const resolveKey = mock.fn(async () => "unused-key");
mock.module("@/lib/system-config", { namedExports: {
  getPlainConfigValue: async (key: string) => values.get(key) ?? null,
  getConfigValue: async () => null,
} });
mock.module("@/lib/chat/api-key", { namedExports: { resolveApiKey: resolveKey } });
let resolveAiProvider: typeof import("./provider").resolveAiProvider;
let embeddings: typeof import("./embedding-provider");
let gemini: typeof import("./gemini-provider");
let geminiEmbedding: typeof import("./gemini-embedding-provider");
let openrouter: typeof import("./openrouter-provider");
let openrouterEmbedding: typeof import("./openrouter-embedding-provider");
const savedRelay = process.env.VQ_MAC_RELAY_ENABLED;
const savedMode = process.env.COHORT_DEMO_MODE;
const savedOrigin = process.env.COHORT_DEMO_LOCAL_AI_ORIGIN;
const savedFence = process.env.COHORT_DEMO_LOCAL_ONLY;
const savedPlain = process.env.AI_LOCAL_ONLY;
const savedPlainOrigin = process.env.AI_LOCAL_APPROVED_ORIGIN;
const messages = [{ role: "user" as const, content: "Hello" }];
const refusal = /Local AI only/;

before(async () => {
  ({ resolveAiProvider } = await import("./provider"));
  embeddings = await import("./embedding-provider");
  gemini = await import("./gemini-provider");
  geminiEmbedding = await import("./gemini-embedding-provider");
  // eslint-disable-next-line no-restricted-syntax -- Synthetic refusal test; asserts zero network calls.
  openrouter = await import("./openrouter-provider");
  // eslint-disable-next-line no-restricted-syntax -- Synthetic refusal test; asserts zero network calls.
  openrouterEmbedding = await import("./openrouter-embedding-provider");
});
beforeEach(() => {
  process.env.COHORT_DEMO_MODE = "true";
  process.env.COHORT_DEMO_LOCAL_AI_ORIGIN = "http://localhost:11434";
  delete process.env.COHORT_DEMO_LOCAL_ONLY;
  delete process.env.VQ_MAC_RELAY_ENABLED;
  delete process.env.AI_LOCAL_ONLY;
  delete process.env.AI_LOCAL_APPROVED_ORIGIN;
  values.clear();
  values.set("ai_provider", "cloud");
  values.set("ai_provider_url", "http://localhost:11434");
  resolveKey.mock.resetCalls();
});
afterEach(() => {
  mock.restoreAll();
  if (savedRelay === undefined) delete process.env.VQ_MAC_RELAY_ENABLED;
  else process.env.VQ_MAC_RELAY_ENABLED = savedRelay;
  if (savedOrigin === undefined) delete process.env.COHORT_DEMO_LOCAL_AI_ORIGIN;
  else process.env.COHORT_DEMO_LOCAL_AI_ORIGIN = savedOrigin;
  if (savedMode === undefined) delete process.env.COHORT_DEMO_MODE;
  else process.env.COHORT_DEMO_MODE = savedMode;
  if (savedFence === undefined) delete process.env.COHORT_DEMO_LOCAL_ONLY;
  else process.env.COHORT_DEMO_LOCAL_ONLY = savedFence;
  if (savedPlain === undefined) delete process.env.AI_LOCAL_ONLY;
  else process.env.AI_LOCAL_ONLY = savedPlain;
  if (savedPlainOrigin === undefined) delete process.env.AI_LOCAL_APPROVED_ORIGIN;
  else process.env.AI_LOCAL_APPROVED_ORIGIN = savedPlainOrigin;
});

test("demo forces local for every sensitivity, including preferCloud and system work", async () => {
  for (const sensitivity of ["public_program", "student_record", "staff_entered", "system", "configured"] as const) {
    const provider = await resolveAiProvider({ studentId: "synthetic", task: "legacy", sensitivity, preferCloud: true });
    assert.equal(provider.name, "ollama");
    assert.equal((provider as unknown as { model: string }).model, "gemma4:12b");
  }
  assert.equal(resolveKey.mock.callCount(), 0);
});

test("missing local configuration refuses without consulting cloud keys", async () => {
  values.delete("ai_provider_url");
  await assert.rejects(resolveAiProvider({ studentId: "synthetic", task: "legacy", sensitivity: "system" }), /not configured/);
  assert.equal(resolveKey.mock.callCount(), 0);
});

test("cloud embeddings are refused without replacing or reindexing their model", async () => {
  await assert.rejects(embeddings.resolveEmbeddingProvider({ sensitivity: "system" }), refusal);
  await assert.rejects(embeddings.getActiveEmbeddingModel(), refusal);
  assert.equal(resolveKey.mock.callCount(), 0);
  assert.equal(values.get("ai_provider"), "cloud");
  process.env.COHORT_DEMO_MODE = "false";
  assert.equal(await embeddings.getActiveEmbeddingModel(), "gemini-embedding-001");
});

test("persistent fence protects deferred work even with demo entry closed", () => {
  process.env.COHORT_DEMO_MODE = "false";
  process.env.COHORT_DEMO_LOCAL_ONLY = " true ";
  assert.equal(isDemoLocalOnlyRequired(), true);
  assert.throws(assertCloudInferenceAllowed, refusal);
  delete process.env.COHORT_DEMO_LOCAL_ONLY;
  assert.doesNotThrow(assertCloudInferenceAllowed);
});

test("all direct cloud generation and embedding paths refuse before network", async () => {
  const fetchSpy = mock.method(globalThis, "fetch", async () => { throw new Error("NETWORK MUST NOT RUN"); });
  const g = new gemini.GeminiProvider("synthetic-key");
  const o = new openrouter.OpenRouterProvider("synthetic-key", undefined, { fetchImpl: globalThis.fetch });
  for (const p of [g, o]) {
    await assert.rejects(p.generateResponse("test", messages), refusal);
    await assert.rejects(p.generateStructuredResponse("test", messages), refusal);
    await assert.rejects(p.streamResponse("test", messages).next(), refusal);
    await assert.rejects(p.streamWithTools("test", messages, [], async () => ({ response: "unused", summary: "unused", status: "success" as const })).next(), refusal);
  }
  await assert.rejects(g.describeDocument(Buffer.from("test"), "text/plain", "test"), refusal);
  await assert.rejects(new geminiEmbedding.GeminiEmbeddingProvider("synthetic-key").embed(["test"], { taskType: "RETRIEVAL_QUERY" }), refusal);
  await assert.rejects(new openrouterEmbedding.OpenRouterEmbeddingProvider("synthetic-key", undefined, { fetchImpl: globalThis.fetch }).embed(["test"], { taskType: "RETRIEVAL_QUERY" }), refusal);
  assert.equal(fetchSpy.mock.callCount(), 0);
});

test("Ollama hosted models and cloud API endpoints cannot masquerade as local", () => {
  for (const url of ["https://ollama.com", "https://api.openai.com", "https://openrouter.ai/api", "https://generativelanguage.googleapis.com"]) {
    process.env.COHORT_DEMO_LOCAL_AI_ORIGIN = new URL(url).origin;
    assert.throws(() => assertLocalDemoTarget(url, "gemma4:12b"), refusal);
  }
  process.env.COHORT_DEMO_LOCAL_AI_ORIGIN = "http://localhost:11434";
  assert.throws(() => assertLocalDemoTarget("http://localhost:11434", "model:cloud"), refusal);
  assert.doesNotThrow(() => assertLocalDemoTarget("http://localhost:11434", "gemma4:12b"));
});


test("demo refuses an unapproved or mismatched local endpoint before resolution", async () => {
  delete process.env.COHORT_DEMO_LOCAL_AI_ORIGIN;
  await assert.rejects(resolveAiProvider({ studentId: "synthetic", task: "legacy", sensitivity: "system" }), /approved endpoint origin is required/);
  process.env.COHORT_DEMO_LOCAL_AI_ORIGIN = "https://approved.example";
  await assert.rejects(resolveAiProvider({ studentId: "synthetic", task: "legacy", sensitivity: "system" }), /does not match/);
  assert.equal(resolveKey.mock.callCount(), 0);
});


test("enabling the Mac connection also fences cloud inference independently of demo entry", () => {
  process.env.COHORT_DEMO_MODE = "false";
  process.env.VQ_MAC_RELAY_ENABLED = "true";
  assert.throws(assertCloudInferenceAllowed, refusal);
});

// ---------------------------------------------------------------------------
// H4: the block has a plain name.
//
// The three switches above are named for the demo or the relay. When the demo
// closes and someone deletes the "demo" variables, the block must not go with
// them, so AI_LOCAL_ONLY turns it on by itself and AI_LOCAL_APPROVED_ORIGIN
// names the approved endpoint. The old names keep working unchanged.
// ---------------------------------------------------------------------------

const LOCAL_ONLY_SWITCHES = ["COHORT_DEMO_MODE", "VQ_MAC_RELAY_ENABLED", "COHORT_DEMO_LOCAL_ONLY", "AI_LOCAL_ONLY"] as const;
const LOCAL_URL = "http://localhost:11434";

/** Clears all four switches, then turns on the one named (or none). */
function onlySwitch(name: (typeof LOCAL_ONLY_SWITCHES)[number] | null) {
  for (const each of LOCAL_ONLY_SWITCHES) delete process.env[each];
  if (name) process.env[name] = "true";
}

for (const name of LOCAL_ONLY_SWITCHES) {
  test(`${name}=true alone turns the cloud block on`, () => {
    onlySwitch(name);
    assert.equal(isDemoLocalOnlyRequired(), true);
    assert.throws(assertCloudInferenceAllowed, refusal);
  });
}

test("with all four switches unset the block is off, as it was before", () => {
  onlySwitch(null);
  assert.equal(isDemoLocalOnlyRequired(), false);
  assert.doesNotThrow(assertCloudInferenceAllowed);
});

test("AI_LOCAL_ONLY is on only for 'true', trimmed and in any case", () => {
  onlySwitch(null);
  for (const value of ["true", " true ", "TRUE", "True"]) {
    process.env.AI_LOCAL_ONLY = value;
    assert.equal(isDemoLocalOnlyRequired(), true, JSON.stringify(value));
  }
  for (const value of ["", "false", "1", "yes", "on", "ture"]) {
    process.env.AI_LOCAL_ONLY = value;
    assert.equal(isDemoLocalOnlyRequired(), false, JSON.stringify(value));
  }
});

test("the plain switch alone forces local resolution and refuses cloud before network", async () => {
  onlySwitch("AI_LOCAL_ONLY");
  const fetchSpy = mock.method(globalThis, "fetch", async () => { throw new Error("NETWORK MUST NOT RUN"); });
  for (const sensitivity of ["public_program", "student_record", "staff_entered", "system", "configured"] as const) {
    const provider = await resolveAiProvider({ studentId: "synthetic", task: "legacy", sensitivity, preferCloud: true });
    assert.equal(provider.name, "ollama");
  }
  await assert.rejects(new gemini.GeminiProvider("synthetic-key").generateResponse("test", messages), refusal);
  await assert.rejects(new geminiEmbedding.GeminiEmbeddingProvider("synthetic-key").embed(["test"], { taskType: "RETRIEVAL_QUERY" }), refusal);
  await assert.rejects(embeddings.resolveEmbeddingProvider({ sensitivity: "system" }), refusal);
  assert.equal(resolveKey.mock.callCount(), 0);
  assert.equal(fetchSpy.mock.callCount(), 0);
});

test("the plain origin name approves the endpoint when the demo name is unset", async () => {
  delete process.env.COHORT_DEMO_LOCAL_AI_ORIGIN;
  process.env.AI_LOCAL_APPROVED_ORIGIN = LOCAL_URL;
  assert.doesNotThrow(() => assertLocalDemoTarget(LOCAL_URL, "gemma4:12b"));
  const provider = await resolveAiProvider({ studentId: "synthetic", task: "legacy", sensitivity: "system" });
  assert.equal(provider.name, "ollama");
  process.env.AI_LOCAL_APPROVED_ORIGIN = "https://approved.example";
  assert.throws(() => assertLocalDemoTarget(LOCAL_URL, "gemma4:12b"), /does not match/);
});

test("with neither origin name set, or only a blank one, the endpoint is refused", () => {
  delete process.env.COHORT_DEMO_LOCAL_AI_ORIGIN;
  assert.throws(() => assertLocalDemoTarget(LOCAL_URL, "gemma4:12b"), /approved endpoint origin is required/);
  process.env.AI_LOCAL_APPROVED_ORIGIN = "   ";
  assert.throws(() => assertLocalDemoTarget(LOCAL_URL, "gemma4:12b"), /approved endpoint origin is required/);
});

test("when both origin names are set the endpoint must match both", () => {
  // The same origin written two ways is one approval, not a disagreement.
  process.env.AI_LOCAL_APPROVED_ORIGIN = `${LOCAL_URL}/`;
  assert.doesNotThrow(() => assertLocalDemoTarget(LOCAL_URL, "gemma4:12b"));
  process.env.AI_LOCAL_APPROVED_ORIGIN = "https://other.example";
  assert.throws(() => assertLocalDemoTarget(LOCAL_URL, "gemma4:12b"), /does not match/);
  process.env.AI_LOCAL_APPROVED_ORIGIN = LOCAL_URL;
  process.env.COHORT_DEMO_LOCAL_AI_ORIGIN = "https://other.example";
  assert.throws(() => assertLocalDemoTarget(LOCAL_URL, "gemma4:12b"), /does not match/);
});

test("the plain origin name is held to the same rules as the demo name", () => {
  delete process.env.COHORT_DEMO_LOCAL_AI_ORIGIN;
  process.env.AI_LOCAL_APPROVED_ORIGIN = "not a url";
  assert.throws(() => assertLocalDemoTarget(LOCAL_URL, "gemma4:12b"), /approved endpoint origin is invalid/);
  for (const bad of ["ftp://localhost:11434", "http://someone@localhost:11434", `${LOCAL_URL}/v1`, `${LOCAL_URL}/?q=1`, `${LOCAL_URL}/#x`]) {
    process.env.AI_LOCAL_APPROVED_ORIGIN = bad;
    assert.throws(() => assertLocalDemoTarget(LOCAL_URL, "gemma4:12b"), /does not match/, bad);
  }
  process.env.AI_LOCAL_APPROVED_ORIGIN = "https://openrouter.ai";
  assert.throws(() => assertLocalDemoTarget("https://openrouter.ai/api", "gemma4:12b"), refusal);
  process.env.AI_LOCAL_APPROVED_ORIGIN = LOCAL_URL;
  assert.throws(() => assertLocalDemoTarget(LOCAL_URL, "model:cloud"), refusal);
});
