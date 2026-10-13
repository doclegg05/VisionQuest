// Test preload: answers every OpenRouter request with STUB_OPENROUTER_STATUS
// and refuses every other request, so an eval run under it never reaches the
// network. Used by scripts/lib/eval-abort.e2e.test.mjs.
const status = Number(process.env.STUB_OPENROUTER_STATUS ?? "402");
const bodies = {
  402: { error: { code: 402, message: "Insufficient credits" } },
  404: { error: { code: 404, message: "No endpoints found matching your data policy" } },
};

globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.includes("openrouter.ai")) throw new Error(`stub fetch refused a non-OpenRouter request: ${url}`);
  return new Response(JSON.stringify(bodies[status] ?? { error: { code: status } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
};
