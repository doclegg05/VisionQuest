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

const DYNAMIC_PROBE = 'export async function probe() {\n  return import("@/lib/ai/openrouter-provider");\n}\n';
const JS_SUFFIX_PROBE =
  'import { OpenRouterProvider } from "@/lib/ai/openrouter-provider.js";\nexport const probe = OpenRouterProvider;\n';
const QUERY_PROBE =
  'import { OpenRouterProvider } from "@/lib/ai/openrouter-provider?raw";\nexport const probe = OpenRouterProvider;\n';
const SCRIPTS_REEXPORT_PROBE = 'export { resolveEvalProvider } from "../../../scripts/lib/sage-eval-provider.mjs";\n';
const JEV_CLIENT_PROBE = 'export { callSystemOne } from "../../scripts/bench/suites/lib/typesafe-client.mjs";\n';
const STUDENT_ALERT_PROBE = "export const probe = (db: { studentAlert: unknown }) => db.studentAlert;\n";

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

  it("rejects a dynamic import", async () => {
    assert.ok((await ruleIds(DYNAMIC_PROBE, "src/app/openrouter-probe.ts")).includes("no-restricted-syntax"));
    assert.ok((await ruleIds(DYNAMIC_PROBE, "src/components/openrouter-probe.tsx")).includes("no-restricted-syntax"));
  });

  it("rejects suffixed specifiers and .mts files", async () => {
    assert.ok((await ruleIds(JS_SUFFIX_PROBE, "src/app/openrouter-probe.ts")).includes("no-restricted-imports"));
    assert.ok((await ruleIds(QUERY_PROBE, "src/app/openrouter-probe.ts")).includes("no-restricted-imports"));
    assert.ok((await ruleIds(ALIAS_PROBE, "src/lib/openrouter-probe.mts")).includes("no-restricted-imports"));
  });

  it("rejects re-exporting the eval chokepoint or the Jev client into app code", async () => {
    assert.ok((await ruleIds(SCRIPTS_REEXPORT_PROBE, "src/lib/ai/openrouter-probe.ts")).includes("no-restricted-imports"));
    assert.ok((await ruleIds(JEV_CLIENT_PROBE, "src/lib/openrouter-probe.ts")).includes("no-restricted-imports"));
  });

  it("keeps the student-alert rule working on student-facing files", async () => {
    assert.ok((await ruleIds(STUDENT_ALERT_PROBE, "src/components/openrouter-probe.tsx")).includes("no-restricted-syntax"));
  });

  it("allows the provider's own test and the scripts folder", async () => {
    assert.ok(!(await ruleIds(RELATIVE_PROBE, "src/lib/ai/openrouter-provider.test.ts")).includes("no-restricted-imports"));
    assert.ok(!(await ruleIds(ALIAS_PROBE, "scripts/openrouter-probe.mjs")).includes("no-restricted-imports"));
  });
});
