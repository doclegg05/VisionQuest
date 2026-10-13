import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";

/**
 * The OpenRouter provider is for evals on synthetic data only. This test
 * proves the lint rule actually fires, by linting probe text under paths
 * that app code lives at. A rule that was never seen failing is not a guard.
 */
const ALIAS_PROBE =
  'import { OpenRouterProvider } from "@/lib/ai/openrouter-provider";\nexport const probe = OpenRouterProvider;\n';
const RELATIVE_PROBE =
  'import { OpenRouterProvider } from "./openrouter-provider";\nexport const probe = OpenRouterProvider;\n';

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((message) => message.ruleId ?? "");
}

describe("OpenRouter import guard", () => {
  it("rejects an import from app code", async () => {
    assert.ok((await ruleIds(ALIAS_PROBE, "src/app/openrouter-probe.ts")).includes("no-restricted-imports"));
  });

  it("rejects a relative import beside the provider", async () => {
    assert.ok((await ruleIds(RELATIVE_PROBE, "src/lib/ai/provider.ts")).includes("no-restricted-imports"));
  });

  it("still rejects it where another block also restricts imports", async () => {
    const ids = await ruleIds(ALIAS_PROBE, "src/app/api/internal/openrouter-probe.ts");
    assert.ok(ids.includes("no-restricted-imports"));
  });

  it("allows the provider's own test and the scripts folder", async () => {
    assert.ok(!(await ruleIds(RELATIVE_PROBE, "src/lib/ai/openrouter-provider.test.ts")).includes("no-restricted-imports"));
    assert.ok(!(await ruleIds(ALIAS_PROBE, "scripts/openrouter-probe.mjs")).includes("no-restricted-imports"));
  });
});
