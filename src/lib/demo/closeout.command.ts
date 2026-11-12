/**
 * Demo closeout (readiness H10): the owner's command without the process
 * around it. scripts/demo-closeout.ts passes in the arguments, the environment,
 * a way to connect and what the checkout says the schema is, and prints what
 * comes back.
 */
import { isCohortDemoEnabled } from "./config";
import { runDemoCloseout, type CloseoutOutcome, type CloseoutTarget } from "./closeout";
import type { CloseoutClient, DemoEnv } from "./closeout.core";
import type { LocalSchema } from "./closeout.local";
import { REFUSALS, USAGE, afterCommitLine, appliedLines, failureSentence, previewLines, targetLines } from "./closeout.report";

export interface CommandResult {
  /** 0 done, 2 refused, 1 stopped, 3 saved but demo accounts remain or could not be counted. */
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}
export type ConnectedClient = CloseoutClient & { $disconnect(): Promise<void> };

/** What the command needs from the machine it runs on. */
export interface CommandSystem {
  readonly connect: (url: string) => ConnectedClient;
  readonly local: LocalSchema;
}

/**
 * How the script opens Prisma. No query log, and errors without the query text:
 * a logged statement or a full error would put ids on the owner's screen.
 */
export function closeoutClientOptions(url: string): { datasources: { db: { url: string } }; log: []; errorFormat: "minimal" } {
  return { datasources: { db: { url } }, log: [], errorFormat: "minimal" };
}

type Parsed =
  | { readonly kind: "help" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "preview" }
  | { readonly kind: "apply"; readonly expectAccounts: number };

const FLAGS = ["--apply", "--confirm-demo-disabled", "--help"];
const EXPECT = /^--expect-accounts=(\d{1,7})$/;

function parseArguments(argv: readonly string[]): Parsed {
  // The argument is not echoed: a pasted connection string would end up on screen.
  if (argv.some((argument) => !FLAGS.includes(argument) && !EXPECT.test(argument))) {
    return { kind: "refused", reason: "an argument is not one this command accepts. Run it with --help." };
  }
  if (argv.includes("--help")) return { kind: "help" };
  const expected = argv.flatMap((argument) => argument.match(EXPECT)?.[1] ?? []);
  if (!argv.includes("--apply")) {
    return expected.length > 0 ? { kind: "refused", reason: "--expect-accounts goes only with --apply. Run it with --help." } : { kind: "preview" };
  }
  if (!argv.includes("--confirm-demo-disabled")) {
    return { kind: "refused", reason: "--apply also needs --confirm-demo-disabled, your word that demo mode is off on the server." };
  }
  if (expected.length !== 1) {
    return { kind: "refused", reason: "--apply also needs --expect-accounts=<number> once, with the number of marked accounts the preview showed." };
  }
  return { kind: "apply", expectAccounts: Number(expected[0]) };
}

const refusedLines = (outcome: CloseoutOutcome): string[] => outcome.refusals.map((entry) => `Refused: ${entry.sentence} (count: ${entry.count})`);

/** The lines for a run that reached an answer. */
function report(outcome: CloseoutOutcome, url: string): CommandResult {
  const head = [...targetLines(outcome.target, url), JSON.stringify(outcome, null, 2)];
  if (outcome.kind === "unreadable") return { exitCode: 2, stdout: head, stderr: refusedLines(outcome) };
  if (outcome.kind === "refused") return { exitCode: 2, stdout: head, stderr: refusedLines(outcome) };
  if (outcome.kind === "preview") return { exitCode: 0, stdout: [...head, ...previewLines(outcome.preview, outcome.refusals)], stderr: [] };
  const after = afterCommitLine(outcome.afterCommit.markedAccounts);
  const stdout = [...head, ...appliedLines(outcome.preview, outcome.orphans)];
  return after.finished ? { exitCode: 0, stdout: [...stdout, after.line], stderr: [] } : { exitCode: 3, stdout, stderr: [after.line] };
}

async function attempt(parsed: Extract<Parsed, { kind: "preview" | "apply" }>, env: DemoEnv, url: string, system: CommandSystem): Promise<CommandResult> {
  const apply = parsed.kind === "apply";
  let client: ConnectedClient | null = null;
  let target: CloseoutTarget | null = null;
  let result: CommandResult;
  try {
    client = system.connect(url);
    const outcome = await runDemoCloseout(client, {
      apply, env, local: system.local,
      expectAccounts: apply ? parsed.expectAccounts : undefined,
      onTarget: (told) => { target = told; },
    });
    result = report(outcome, url);
  } catch (error) {
    // The error is read for its code and never printed: a Prisma error can
    // quote an identifier, a row value or the connection string.
    result = { exitCode: 1, stdout: target ? targetLines(target, url) : [], stderr: [failureSentence(error, apply)] };
  }
  try {
    await client?.$disconnect();
  } catch {
    return { ...result, stderr: [...result.stderr, "Note: the database connection did not close cleanly."] };
  }
  return result;
}

/**
 * The owner's command: previews by default, applies with the three arguments.
 * Exit 0 done, 2 refused, 1 stopped, 3 saved but not finished.
 */
export async function runCloseoutCommand(argv: readonly string[], env: DemoEnv, system: CommandSystem): Promise<CommandResult> {
  const parsed = parseArguments(argv);
  if (parsed.kind === "help") return { exitCode: 0, stdout: USAGE, stderr: [] };
  const refuse = (reason: string): CommandResult => ({ exitCode: 2, stdout: [], stderr: [`Refused: ${reason}`] });
  if (parsed.kind === "refused") return refuse(parsed.reason);
  const url = env.ADMIN_DATABASE_URL;
  if (!url) return refuse("set ADMIN_DATABASE_URL in this terminal first. This command reads no file for it.");
  if (parsed.kind === "apply" && isCohortDemoEnabled(env)) return refuse(REFUSALS.demo_mode_on);
  return attempt(parsed, env, url, system);
}
