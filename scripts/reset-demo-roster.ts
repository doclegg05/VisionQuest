/** Run with an explicitly supplied admin database URL; never auto-load .env.local. */
import { PrismaClient } from "@prisma/client";
import { isCohortDemoEnabled } from "../src/lib/demo/config";
import { resetDemoRoster } from "../src/lib/demo/reset";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: node --import tsx scripts/reset-demo-roster.ts [--apply --confirm-demo-disabled]");
    console.log("Defaults to preview. Requires ADMIN_DATABASE_URL. Disable demo mode on all servers before applying; restart when re-enabling.");
  } else {
    const apply = args.includes("--apply");
    if (args.some((arg) => !["--apply", "--confirm-demo-disabled"].includes(arg)) ||
        (apply && (!args.includes("--confirm-demo-disabled") || isCohortDemoEnabled())) ||
        !process.env.ADMIN_DATABASE_URL) {
      console.error("Refused: supply ADMIN_DATABASE_URL; applying also requires demo mode off and --confirm-demo-disabled.");
      process.exitCode = 2;
    } else {
      const client = new PrismaClient({ datasources: { db: { url: process.env.ADMIN_DATABASE_URL } } });
      try {
        console.log(JSON.stringify(await resetDemoRoster(client, { apply })));
      } catch {
        // Prisma error messages can contain identifiers and connection details.
        console.error("Demo reset failed. Transaction rolled back; check classroom ownership and database availability.");
        process.exitCode = 1;
      } finally {
        await client.$disconnect();
      }
    }
  }

}

void main();
