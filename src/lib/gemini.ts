// src/lib/gemini.ts
// Shared GEMINI_MODEL constant — single source of truth, imported by
// gemini-provider.ts and the API key test routes. All AI inference goes
// through src/lib/ai/provider.ts.

export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
