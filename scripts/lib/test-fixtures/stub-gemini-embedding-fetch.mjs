// Test preload: answers every Gemini embedding request according to
// STUB_GEMINI_EMBEDDING and refuses every other request, so a run under it
// never reaches the network.
//   ok           768-dimension vectors, one per requested text
//   invalid-key  Google's 400 API_KEY_INVALID body
//   prepayment   a 429 whose body says the prepaid credits are depleted
//   network      fails the way fetch does when the connection never happens
// Used by scripts/lib/eval-abort.e2e.test.mjs.
const mode = process.env.STUB_GEMINI_EMBEDDING ?? "ok";

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.includes("generativelanguage.googleapis.com")) {
    throw new Error(`stub fetch refused a non-Gemini request: ${url}`);
  }
  if (mode === "network") throw new TypeError("fetch failed");
  if (mode === "invalid-key") {
    return json(400, {
      error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" },
    });
  }
  if (mode === "prepayment") {
    return json(429, { error: { code: 429, message: "Your prepayment credits are depleted.", status: "RESOURCE_EXHAUSTED" } });
  }
  const count = JSON.parse(String(init?.body ?? "{}")).requests?.length ?? 1;
  const values = Array.from({ length: 768 }, (_, index) => (index === 0 ? 1 : 0));
  return json(200, { embeddings: Array.from({ length: count }, () => ({ values })) });
};
