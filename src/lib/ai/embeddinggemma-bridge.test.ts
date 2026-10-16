import assert from "node:assert/strict";
import { it, mock } from "node:test";

mock.module("@/lib/llm-usage", { namedExports: { logLlmCall: async () => {} } });

it("VisionQuest adapter retrieves matching synthetic documents through the real local bridge", {
  skip: process.env.VQ_TEST_EMBEDDING_BRIDGE !== "1",
}, async () => {
  const { OllamaEmbeddingProvider } = await import("./ollama-embedding-provider");
  const endpoint = "http://127.0.0.1:11436";
  const provider = new OllamaEmbeddingProvider(endpoint, "google/embeddinggemma-2");
  const documents = [
    "Prepare for a job interview by practicing common questions and examples of your skills.",
    "A resume lists work experience, education, and skills for a job application.",
    "Tomato plants need sunlight, water, and well-drained soil.",
  ];
  const queries = ["How do I get ready for a job interview?", "What goes on my resume?", "How do I grow tomatoes?"];
  const docs = await provider.embed(documents, { taskType: "RETRIEVAL_DOCUMENT" });
  const qs = await provider.embed(queries, { taskType: "RETRIEVAL_QUERY" });
  for (const vector of [...docs, ...qs]) {
    assert.equal(vector.length, 768);
    assert.ok(vector.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-5);
  }
  const scores = qs.map((q) => docs.map((d) => q.reduce((sum, v, i) => sum + v * d[i], 0)));
  assert.deepEqual(scores.map((row) => row.indexOf(Math.max(...row))), [0, 1, 2]);
  console.log("Synthetic adapter cosine scores:", JSON.stringify(scores));

  // The bridge must use the same vector space/prefixes as direct offline inference.
  const direct = await fetch(`${endpoint}/api/embed`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: provider.model, input: queries.map((q) => `task: search result | query: ${q}`) }),
  });
  const payload = await direct.json();
  qs.forEach((q, i) => q.forEach((value, j) => assert.ok(Math.abs(value - payload.embeddings[i][j]) < 1e-5)));
  const openAi = new OllamaEmbeddingProvider(endpoint, provider.model, { apiStyle: "openai", authMode: "none" });
  const compatible = await openAi.embed([queries[0]], { taskType: "RETRIEVAL_QUERY" });
  qs[0].forEach((value, j) => assert.ok(Math.abs(value - compatible[0][j]) < 1e-5));
  const rejected = await fetch(`${endpoint}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gemma4:26b-a4b-it-qat", messages: [] }),
  });
  assert.equal(rejected.status, 400);
  const tags = await (await fetch(`${endpoint}/api/tags`)).json();
  assert.deepEqual(tags.models.map((entry: { name: string }) => entry.name).sort(), ["gemma4:12b", "google/embeddinggemma-2"]);
});
