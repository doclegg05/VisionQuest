import { before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { DataSensitivity } from "../types";

/**
 * Real student data never reaches OpenRouter. Neither app resolver may hand
 * back a provider named "openrouter", for any sensitivity, under either
 * ai_provider setting.
 */
let aiProvider: "cloud" | "local" = "cloud";
const CONFIG: Readonly<Record<string, string>> = {
  ai_provider_url: "http://localhost:11434",
  ai_provider_model: "llama3.1:8b",
  ai_provider_embedding_model: "nomic-embed-text",
};

mock.module("@/lib/system-config", {
  namedExports: {
    getPlainConfigValue: async (key: string) => (key === "ai_provider" ? aiProvider : (CONFIG[key] ?? null)),
    getConfigValue: async (key: string) => CONFIG[key] ?? null,
  },
});
mock.module("@/lib/chat/api-key", { namedExports: { resolveApiKey: async () => "test-cloud-key" } });
mock.module("@/lib/audit", { namedExports: { logAuditEvent: async () => undefined } });
mock.module("../identity", { namedExports: { loadIdentityInput: async () => ({}) } });

let resolveAiProvider: Awaited<typeof import("../provider")>["resolveAiProvider"];
let resolveEmbeddingProvider: Awaited<typeof import("../embedding-provider")>["resolveEmbeddingProvider"];

before(async () => {
  ({ resolveAiProvider } = await import("../provider"));
  ({ resolveEmbeddingProvider } = await import("../embedding-provider"));
});

const SENSITIVITIES: readonly DataSensitivity[] = [
  "configured",
  "student_record",
  "staff_entered",
  "public_program",
  "system",
];
const PRODUCTION_NAMES = new Set(["gemini", "ollama"]);

describe("OpenRouter is unreachable from the app's provider pickers", () => {
  for (const setting of ["cloud", "local"] as const) {
    for (const sensitivity of SENSITIVITIES) {
      it(`resolveAiProvider, ai_provider=${setting}, ${sensitivity}`, async () => {
        aiProvider = setting;
        const provider = await resolveAiProvider({ studentId: "student-1", task: "legacy", sensitivity });
        assert.ok(PRODUCTION_NAMES.has(provider.name), provider.name);
      });

      it(`resolveEmbeddingProvider, ai_provider=${setting}, ${sensitivity}`, async () => {
        aiProvider = setting;
        const provider = await resolveEmbeddingProvider({ studentId: "student-1", sensitivity });
        assert.ok(PRODUCTION_NAMES.has(provider.name), provider.name);
      });
    }
  }
});
