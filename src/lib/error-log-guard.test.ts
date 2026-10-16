import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";

/**
 * Proves the rawErrorTextInLogs ESLint rule fires across src/, by linting
 * probe text. A rule that was never seen failing is not a guard (the same
 * approach as src/lib/ai/openrouter-import-guard.test.ts).
 *
 * Flat config replaces a rule's options when a later block sets the same
 * rule, so the last describe block lints one probe per selector group at a
 * path owned by each no-restricted-syntax block in eslint.config.mjs. A block
 * added later that forgets to repeat a group fails here instead of silently
 * switching the group off, as the OpenRouter block once did to the teacher
 * raw-palette rule.
 */
const PRELUDE = [
  "declare const logger: { error: (m: string, c?: object) => void; info: (m: string, c?: object) => void };",
  "declare function work(): void;",
  "declare function errorForLog(e: unknown): object;",
  "declare function providerErrorText(e: unknown): string;",
  "declare function errorMessage(e: unknown): string;",
  "declare function getErrorMessage(e: unknown): string;",
  "declare const sent: number;",
  "",
].join("\n");

function inCatch(name: string, log: string): string {
  return `${PRELUDE}export function probe() {\n  try {\n    work();\n  } catch (${name}) {\n    ${log}\n  }\n}\n`;
}

const eslint = new ESLint({ cwd: process.cwd() });

async function restrictedSyntaxCount(code: string, filePath: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === "no-restricted-syntax").length;
}

const INTERNAL_ROUTE = "src/app/api/internal/probe/route.ts";

const REJECTED: Record<string, string> = {
  "error.message": inCatch("err", 'logger.error("x", { error: err instanceof Error ? err.message : "" });'),
  "computed error['message']": inCatch("err", 'logger.error("x", { error: (err as Error)["message"] });'),
  "error.stack": inCatch("err", 'logger.error("x", { stack: (err as Error).stack });'),
  "String(error)": inCatch("err", 'logger.error("x", { error: String(err) });'),
  "error.toString()": inCatch("err", 'logger.error("x", { error: (err as Error).toString() });'),
  "the raw error object": inCatch("err", 'logger.error("x", { error: err });'),
  "the raw error object, shorthand": inCatch("error", 'logger.error("x", { error });'),
  "the raw error as a cause": inCatch("err", 'logger.error("x", { cause: err });'),
  "the raw error as a reason": inCatch("err", 'logger.error("x", { reason: err });'),
  "JSON.stringify(error)": inCatch("err", 'logger.error("x", { error: JSON.stringify(err) });'),
  "the error in a template literal": inCatch("err", "logger.error(`failed: ${err}`);"),
  "the error concatenated into a string": inCatch("arcErr", 'logger.error("failed: " + arcErr);'),
  "an errorMessage() helper": inCatch("err", 'logger.error("x", { error: errorMessage(err) });'),
  "a getErrorMessage() helper": inCatch("err", 'logger.error("x", { error: getErrorMessage(err) });'),
};

const ALLOWED: Record<string, string> = {
  "errorForLog(error)": inCatch("err", 'logger.error("x", { error: errorForLog(err) });'),
  "providerErrorText(error)": inCatch(
    "err",
    'logger.error("x", { error: errorForLog(err), providerText: providerErrorText(err) });',
  ),
  "the error's class name behind an instanceof check": inCatch(
    "err",
    'logger.error("x", { errorName: err instanceof Error ? err.name : typeof err });',
  ),
  "a reason enum, shorthand": `${PRELUDE}export function probe(reason: "low_mood" | "chat") {\n  logger.error("x", { reason });\n}\n`,
  "a count in a template literal": `${PRELUDE}export function probe() {\n  logger.info(\`sent \${sent}\`);\n}\n`,
  "shorthand counts": `${PRELUDE}export function probe(scanned: number) {\n  logger.info("done", { scanned, sent });\n}\n`,
};

describe("error-log guard: forms", () => {
  for (const [form, code] of Object.entries(REJECTED)) {
    it(`rejects ${form} in a logger call`, async () => {
      assert.ok((await restrictedSyntaxCount(code, INTERNAL_ROUTE)) > 0, `the rule let ${form} through`);
    });
  }

  for (const [form, code] of Object.entries(ALLOWED)) {
    it(`allows ${form}`, async () => {
      assert.equal(await restrictedSyntaxCount(code, INTERNAL_ROUTE), 0);
    });
  }
});

// One probe per selector group. Each must fire at every path listed for it.
const GROUP_PROBES = {
  rawErrorText: inCatch("err", 'logger.error("x", { error: String(err) });'),
  studentIdInLogs: `${PRELUDE}export function probe(studentId: string) {\n  logger.info("x", { studentId });\n}\n`,
  openRouterDynamicImport: 'export async function probe() {\n  return import("@/lib/ai/openrouter-provider");\n}\n',
  studentAlertDirectRead: "export const probe = (db: { studentAlert: unknown }) => db.studentAlert;\n",
  rawPalette: 'export const probe = "rounded bg-red-500 p-2";\n',
} as const;

type Group = keyof typeof GROUP_PROBES;

const EVERY_SRC_FILE: Group[] = ["rawErrorText", "studentIdInLogs"];
const APP_CODE: Group[] = [...EVERY_SRC_FILE, "openRouterDynamicImport"];

const EXPECTED_GROUPS: Record<string, Group[]> = {
  [INTERNAL_ROUTE]: APP_CODE,
  "src/app/api/cron/probe/route.ts": APP_CODE,
  "src/lib/probe.ts": APP_CODE,
  "src/app/api/probe/route.ts": [...APP_CODE, "studentAlertDirectRead"],
  "src/app/(student)/probe/page.tsx": [...APP_CODE, "studentAlertDirectRead"],
  "src/lib/progression/probe.ts": [...APP_CODE, "studentAlertDirectRead"],
  "src/components/teacher/Probe.tsx": [...APP_CODE, "rawPalette"],
  "src/app/(teacher)/probe/page.tsx": [...APP_CODE, "rawPalette"],
  "src/components/certifications/CertTracker.tsx": [...APP_CODE, "studentAlertDirectRead", "rawPalette"],
  // Exempt from the OpenRouter import rules, not from the rest.
  "src/lib/ai/openrouter-embedding-provider.ts": EVERY_SRC_FILE,
};

describe("error-log guard: every no-restricted-syntax block keeps every group", () => {
  for (const [filePath, groups] of Object.entries(EXPECTED_GROUPS)) {
    for (const group of groups) {
      it(`${filePath} keeps ${group}`, async () => {
        assert.ok(
          (await restrictedSyntaxCount(GROUP_PROBES[group], filePath)) > 0,
          `${group} does not fire at ${filePath}; a later block in eslint.config.mjs replaced it`,
        );
      });
    }
  }
});
