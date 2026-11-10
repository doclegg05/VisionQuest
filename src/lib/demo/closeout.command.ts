/**
 * Demo closeout (readiness H10): the owner's command without the process
 * around it. scripts/demo-closeout.ts passes in the arguments, the environment
 * and a way to connect, and prints what comes back.
 */
import { isCohortDemoEnabled } from "./config";
import { runDemoCloseout } from "./closeout";
import type { CloseoutClient, DemoEnv } from "./closeout.core";
import { REFUSALS } from "./closeout.report";

export interface CommandResult {
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}
export type ConnectedClient = CloseoutClient & { $disconnect(): Promise<void> };

const KNOWN_ARGUMENTS = ["--apply", "--confirm-demo-disabled", "--help"];
const USAGE = [
  "Usage: node --import tsx scripts/demo-closeout.ts [--apply --confirm-demo-disabled]",
  "With no argument it previews: it prints counts and deletes nothing.",
  "With both arguments it deletes the marked demo accounts, the demo class and their rows in one transaction.",
  "It needs ADMIN_DATABASE_URL set in this shell and reads no file for it. Turn demo mode off on every server first.",
  "Exit codes: 0 done, 2 refused, 1 failed.",
];
const FAILURE = "Demo closeout failed. The transaction was rolled back, so nothing was deleted. Check that the database is reachable, then run the preview again.";

function refusedBeforeConnecting(argv: readonly string[], env: DemoEnv): string | null {
  // The argument is not echoed: a pasted connection string would end up on screen.
  if (argv.some((argument) => !KNOWN_ARGUMENTS.includes(argument))) return "an argument is not one this command accepts. Run it with --help.";
  const apply = argv.includes("--apply");
  if (apply && !argv.includes("--confirm-demo-disabled")) return "--apply also needs --confirm-demo-disabled, your word that demo mode is off on every server.";
  if (!env.ADMIN_DATABASE_URL) return "set ADMIN_DATABASE_URL in this shell first. This command reads no file for it.";
  if (apply && isCohortDemoEnabled(env)) return REFUSALS.demo_mode_on;
  return null;
}

async function attempt(apply: boolean, env: DemoEnv, client: ConnectedClient): Promise<CommandResult> {
  const outcome = await runDemoCloseout(client, { apply, env });
  const stdout = [JSON.stringify(outcome, null, 2)];
  if (outcome.kind !== "refused") return { exitCode: 0, stdout, stderr: [] };
  return { exitCode: 2, stdout, stderr: outcome.refusals.map((entry) => `Refused: ${entry.sentence} (count: ${entry.count})`) };
}

/**
 * The owner's command, without the process around it: scripts/demo-closeout.ts
 * passes in the arguments, the environment and a way to connect, and prints
 * what comes back. Exit 0 done, 2 refused, 1 failed.
 */
export async function runCloseoutCommand(
  argv: readonly string[],
  env: DemoEnv,
  connect: (url: string) => ConnectedClient,
): Promise<CommandResult> {
  if (argv.includes("--help") && argv.every((argument) => KNOWN_ARGUMENTS.includes(argument))) return { exitCode: 0, stdout: USAGE, stderr: [] };
  const reason = refusedBeforeConnecting(argv, env);
  const url = env.ADMIN_DATABASE_URL;
  if (reason !== null || !url) return { exitCode: 2, stdout: [], stderr: [`Refused: ${reason ?? "set ADMIN_DATABASE_URL."}`] };

  let client: ConnectedClient | null = null;
  let result: CommandResult;
  try {
    client = connect(url);
    result = await attempt(argv.includes("--apply"), env, client);
  } catch {
    // Deliberately not printed: a Prisma error can quote an identifier or the
    // connection string. The fixed sentence is the whole report.
    result = { exitCode: 1, stdout: [], stderr: [FAILURE] };
  }
  try {
    await client?.$disconnect();
  } catch {
    return { ...result, stderr: [...result.stderr, "Note: the database connection did not close cleanly."] };
  }
  return result;
}
