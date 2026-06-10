// src/lib/gemini.ts
// Legacy module — kept for GEMINI_MODEL export used by API key test routes.
// All AI inference now goes through src/lib/ai/provider.ts.

export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
