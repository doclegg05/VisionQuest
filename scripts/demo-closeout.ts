/**
 * Owner's command for the demo closeout (readiness H10). DEPLOY.md, "Turn it
 * off after Dec 18, 2026", has the steps around it.
 *
 *   node --import tsx scripts/demo-closeout.ts
 *   node --import tsx scripts/demo-closeout.ts --apply --confirm-demo-disabled --expect-accounts=<number>
 *
 * With no argument it previews. It takes the admin database URL from
 * ADMIN_DATABASE_URL in the terminal that runs it, never loads .env.local, and
 * never prints the URL. Everything it does and every word it prints comes from
 * `runCloseoutCommand` in src/lib/demo/closeout.command.ts, which the unit
 * tests cover; this file only supplies the real database client, the checkout
 * it sits in and the process.
 */
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { closeoutClientOptions, runCloseoutCommand } from "../src/lib/demo/closeout.command";
import { readLocalSchema } from "../src/lib/demo/closeout.local";

async function main(): Promise<void> {
  const result = await runCloseoutCommand(process.argv.slice(2), process.env, {
    connect: (url) => new PrismaClient(closeoutClientOptions(url)),
    local: readLocalSchema(path.resolve(__dirname, "..")),
  });
  for (const line of result.stdout) console.log(line);
  for (const line of result.stderr) console.error(line);
  process.exitCode = result.exitCode;
}

void main();
