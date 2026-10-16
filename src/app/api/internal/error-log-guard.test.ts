import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";

/**
 * Proves the internalRouteErrorLogs ESLint rule fires, by linting probe text
 * at an internal-route path. A rule that was never seen failing is not a
 * guard (the same approach as src/lib/ai/openrouter-import-guard.test.ts).
 */
const PROBE_PATH = "src/app/api/internal/probe/route.ts";
const PRELUDE = [
  "declare const logger: { error: (m: string, c?: object) => void; info: (m: string, c?: object) => void };",
  "declare function work(): void;",
  "declare function errorForLog(e: unknown): object;",
  "declare const sent: number;",
  "",
].join("\n");

function inCatch(name: string, log: string): string {
  return `${PRELUDE}export function probe() {\n  try {\n    work();\n  } catch (${name}) {\n    ${log}\n  }\n}\n`;
}

async function restrictedSyntaxCount(code: string): Promise<number> {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(code, { filePath: PROBE_PATH });
  return result.messages.filter((message) => message.ruleId === "no-restricted-syntax").length;
}

const REJECTED: Record<string, string> = {
  "error.message": inCatch("err", 'logger.error("x", { error: err instanceof Error ? err.message : "" });'),
  "computed error['message']": inCatch("err", 'logger.error("x", { error: (err as Error)["message"] });'),
  "error.stack": inCatch("err", 'logger.error("x", { stack: (err as Error).stack });'),
  "String(error)": inCatch("err", 'logger.error("x", { error: String(err) });'),
  "error.toString()": inCatch("err", 'logger.error("x", { error: (err as Error).toString() });'),
  "the raw error object": inCatch("err", 'logger.error("x", { error: err });'),
  "the raw error object, shorthand": inCatch("error", 'logger.error("x", { error });'),
  "the raw error as a cause": inCatch("err", 'logger.error("x", { cause: err });'),
  "JSON.stringify(error)": inCatch("err", 'logger.error("x", { error: JSON.stringify(err) });'),
  "the error in a template literal": inCatch("err", "logger.error(`failed: ${err}`);"),
  "the error concatenated into a string": inCatch("arcErr", 'logger.error("failed: " + arcErr);'),
};

const ALLOWED: Record<string, string> = {
  "errorForLog(error)": inCatch("err", 'logger.error("x", { error: errorForLog(err) });'),
  "a count in a template literal": `${PRELUDE}export function probe() {\n  logger.info(\`sent \${sent}\`);\n}\n`,
  "shorthand counts": `${PRELUDE}export function probe(scanned: number) {\n  logger.info("done", { scanned, sent });\n}\n`,
};

describe("internal-route error-log guard", () => {
  for (const [form, code] of Object.entries(REJECTED)) {
    it(`rejects ${form} in a logger call`, async () => {
      assert.ok((await restrictedSyntaxCount(code)) > 0, `the rule let ${form} through`);
    });
  }

  for (const [form, code] of Object.entries(ALLOWED)) {
    it(`allows ${form}`, async () => {
      assert.equal(await restrictedSyntaxCount(code), 0);
    });
  }
});
