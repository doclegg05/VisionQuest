#!/usr/bin/env node
// Benchmark suite: migration-drift-schema (requires: postgres; skips cleanly
// otherwise). Confirms prisma/migrations, replayed from scratch, produces
// exactly prisma/schema.prisma — no hand-edited schema.prisma field drifted
// away from what the committed migration history actually creates.
//
// `prisma migrate diff --from-migrations` requires a shadow database to
// replay the migration history into (Prisma applies every migration to it,
// then diffs the resulting shape against the target). That replay is
// destructive to whatever the shadow database currently holds, so this suite
// deliberately does NOT reuse the app's hermetic Postgres — reusing it could
// wipe or corrupt fixtures a sibling suite is relying on in the same run.
// It only runs against a database named for exactly this purpose via
// SHADOW_DATABASE_URL (an operator/CI-owned variable, not one of the
// contract's `requires` env checks, precisely so this never fires by
// accident against a shared database). No SHADOW_DATABASE_URL => skip, same
// as any other unmet `requires`.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");

const DIFF_TIMEOUT_MS = 60_000;

export async function run(ctx) {
  const shadowUrl = ctx?.env?.shadowDatabaseUrl ?? process.env.SHADOW_DATABASE_URL;

  if (!shadowUrl) {
    // Mirrors the runner's own `requires` skip shape for a direct/self-test
    // invocation that never goes through the runner's env gating.
    return {
      metrics: [
        {
          id: "schema_migration_drift",
          value: 0,
          n: 0,
          details: {
            skipped: true,
            reason:
              "SHADOW_DATABASE_URL is not set — this suite only runs against a database dedicated to being replayed and diffed, never the shared hermetic DB.",
          },
        },
      ],
    };
  }

  const args = [
    "prisma",
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--shadow-database-url",
    shadowUrl,
    "--script",
    "--exit-code",
  ];

  try {
    const { stdout } = await execFileAsync("npx", args, {
      cwd: REPO_ROOT,
      timeout: DIFF_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    // --exit-code makes an EMPTY diff exit 0; a non-empty diff exits 2 and
    // lands in the catch block below. Reaching here with a non-empty script
    // would be surprising, but treat it as drift rather than trust the exit
    // code alone.
    const trimmed = stdout.trim();
    return {
      metrics: [
        {
          id: "schema_migration_drift",
          value: trimmed.length === 0 ? 0 : 1,
          n: 1,
          details: trimmed.length === 0 ? {} : { script: trimmed.slice(0, 4000) },
        },
      ],
    };
  } catch (error) {
    // exit-code 2 = non-empty diff (real drift); anything else is a tooling
    // failure, reported the same way so it is visible rather than swallowed.
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const isDrift = error?.code === 2 && stdout.trim().length > 0;
    return {
      metrics: [
        {
          id: "schema_migration_drift",
          value: 1,
          n: 1,
          details: isDrift
            ? { script: stdout.trim().slice(0, 4000) }
            : { toolingError: String(error?.message ?? error) },
        },
      ],
    };
  }
}

if (process.argv.includes("--self-test")) {
  run({ fixture: null, fixturePath: null, env: {}, log: console.log, now: () => new Date() })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      // No SHADOW_DATABASE_URL in a self-test environment => must skip
      // cleanly (exit 0), per the suite's own contract.
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
