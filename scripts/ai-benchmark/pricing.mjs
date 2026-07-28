export const PRICING_SNAPSHOT = Object.freeze({
  checkedAt: "2026-07-28",
  currency: "USD",
  unitTokens: 1_000_000,
  providers: {
    gemini: {
      model: "gemini-3.1-flash-lite",
      inputPerMillion: 0.25,
      outputPerMillion: 1.5,
      source: "https://ai.google.dev/gemini-api/docs/pricing",
      note: "Standard text pricing; billable output includes thinking tokens.",
    },
    openai: {
      model: "gpt-5-mini",
      inputPerMillion: 0.25,
      cachedInputPerMillion: 0.025,
      outputPerMillion: 2,
      source: "https://developers.openai.com/api/docs/models/gpt-5-mini",
      note: "Standard API text-token pricing.",
    },
  },
});

function nonNegativeNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function estimateRunCost(provider, usage, pricing = PRICING_SNAPSHOT) {
  const inputTokens = nonNegativeNumber(usage?.inputTokens);
  const outputTokens = nonNegativeNumber(usage?.outputTokens);
  const cachedInputTokens = Math.min(inputTokens, nonNegativeNumber(usage?.cachedInputTokens));
  const rate = pricing.providers[provider];
  if (!rate) throw new Error(`No pricing snapshot for provider "${provider}"`);

  if (provider === "openai") {
    const uncachedInputTokens = inputTokens - cachedInputTokens;
    return (
      uncachedInputTokens * rate.inputPerMillion +
      cachedInputTokens * rate.cachedInputPerMillion +
      outputTokens * rate.outputPerMillion
    ) / pricing.unitTokens;
  }

  return (inputTokens * rate.inputPerMillion + outputTokens * rate.outputPerMillion) / pricing.unitTokens;
}
