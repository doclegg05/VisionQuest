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
const savedMode = process.env.COHORT_DEMO_MODE;
const savedFence = process.env.COHORT_DEMO_LOCAL_ONLY;
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
  delete process.env.COHORT_DEMO_LOCAL_ONLY;
  values.clear();
  values.set("ai_provider", "cloud");
  values.set("ai_provider_url", "http://localhost:11434");
  resolveKey.mock.resetCalls();
});
afterEach(() => {
  mock.restoreAll();
  if (savedMode === undefined) delete process.env.COHORT_DEMO_MODE;
  else process.env.COHORT_DEMO_MODE = savedMode;
  if (savedFence === undefined) delete process.env.COHORT_DEMO_LOCAL_ONLY;
  else process.env.COHORT_DEMO_LOCAL_ONLY = savedFence;
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
    assert.throws(() => assertLocalDemoTarget(url, "gemma4:12b"), refusal);
  }
  assert.throws(() => assertLocalDemoTarget("http://localhost:11434", "model:cloud"), refusal);
  assert.doesNotThrow(() => assertLocalDemoTarget("http://localhost:11434", "gemma4:12b"));
});
