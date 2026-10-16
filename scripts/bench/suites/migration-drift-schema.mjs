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
//
// The metric counts the statements the diff would run to turn the replayed
// history into schema.prisma. Some objects exist only as raw SQL because the
// schema language cannot declare them (HNSW and GIN indexes, a generated
// column), so the diff always proposes dropping them. Each of those is listed,
// verbatim and with its reason, in
// config/benchmarks/fixtures/migration-drift-schema.json; any other statement
// is drift. A diff that could not run throws, so the runner records an error
// instead of drift that was never compared.

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

  assertDisposableShadow(shadowUrl, {
    DATABASE_URL: ctx?.env?.databaseUrl ?? process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    ADMIN_DATABASE_URL: process.env.ADMIN_DATABASE_URL,
  });

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

  let script;
  try {
    ({ stdout: script } = await execFileAsync("npx", args, {
      cwd: REPO_ROOT,
      timeout: DIFF_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (error) {
    script = scriptFromDiffFailure(error);
  }
  return { metrics: [scoreDiff(script, ctx?.fixture)] };
}

// Prisma resets the shadow database before replaying into it, so only a
// throwaway database on this machine qualifies: a loopback host, and not the
// database any app URL names. The only Supabase project is production.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function databaseKey(url) {
  const parsed = new URL(url);
  const host = LOOPBACK_HOSTS.has(parsed.hostname) ? "loopback" : parsed.hostname;
  return `${host}:${parsed.port || "5432"}/${decodeURIComponent(parsed.pathname.slice(1))}`;
}

export function assertDisposableShadow(shadowUrl, appUrls) {
  const shadowHost = new URL(shadowUrl).hostname;
  if (!LOOPBACK_HOSTS.has(shadowHost)) {
    throw new Error(
      `SHADOW_DATABASE_URL points at ${shadowHost}, not a loopback host. The replay resets that database, ` +
        "so it must be a throwaway one on this machine."
    );
  }
  for (const [name, url] of Object.entries(appUrls)) {
    if (url && databaseKey(url) === databaseKey(shadowUrl)) {
      throw new Error(`SHADOW_DATABASE_URL names the same database as ${name}, which the replay would reset.`);
    }
  }
}

// --exit-code makes a non-empty diff exit 2 with its script on stdout. Any
// other failure means nothing was compared.
export function scriptFromDiffFailure(error) {
  const stdout = typeof error?.stdout === "string" ? error.stdout : "";
  if (error?.code === 2 && stdout.trim().length > 0) return stdout;
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim().slice(-2000) : "";
  throw new Error(
    `prisma migrate diff did not finish, so nothing was measured: ${error?.message ?? error}` +
      (stderr ? `\n${stderr}` : "")
  );
}

// One entry per statement, comments dropped and whitespace collapsed, so a
// statement compares equal however Prisma wraps it.
function diffStatements(script) {
  return script
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => `${statement};`);
}

function exemptionsFrom(fixture) {
  const entries = Array.isArray(fixture?.exemptions) ? fixture.exemptions : [];
  for (const entry of entries) {
    if (typeof entry?.reason !== "string" || entry.reason.trim().length === 0) {
      throw new Error(`exemption ${JSON.stringify(entry?.statement)} has no reason, and an unexplained exemption hides drift`);
    }
  }
  return new Set(entries.map((entry) => diffStatements(entry.statement).join(" ")));
}

export function scoreDiff(script, fixture) {
  const exempt = exemptionsFrom(fixture);
  const statements = diffStatements(script);
  const unexplained = statements.filter((statement) => !exempt.has(statement));
  const exempted = statements.filter((statement) => exempt.has(statement));
  const staleExemptions = [...exempt].filter((statement) => !statements.includes(statement));
  return {
    id: "schema_migration_drift",
    value: unexplained.length,
    n: 1,
    details: { unexplained: unexplained.slice(0, 50), exempted, staleExemptions },
  };
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
