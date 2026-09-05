/**
 * bench suite: scheduled-layer-drift (config/benchmarks/scheduled-layer-drift.json)
 *
 * Gate tier, no `requires` — filesystem only, so this runs on every PR with
 * no database and no secrets. Compares `EXPECTED_CRON_JOBS`
 * (scripts/lib/cron-health.mjs, the list `cron-health-check.mjs` and the
 * nightly cron-health.yml workflow verify) against every job name a
 * `cron.schedule('<name>'` call registers across
 * `prisma/migrations/*cron*` directories' `migration.sql` files.
 *
 * This is the exact class of drift the 2026-09-01 review found: the 4
 * baseline cron jobs were registered nowhere the health check's expected
 * list agreed with, invisible for five months until someone queried prod
 * directly (.claude/MEMORY.md, "the scheduled layer has never worked in
 * prod"). A migration that starts scheduling a job the health check does
 * not know about, or stops re-registering one it does, now fails on the
 * migration diff instead of silently drifting.
 *
 * Two directions, both floored at 0:
 *   - unregistered_expected_jobs: a name in EXPECTED_CRON_JOBS that no
 *     `*cron*` migration's `cron.schedule()` call registers.
 *   - unexpected_registered_jobs: a name a `*cron*` migration registers that
 *     is not in EXPECTED_CRON_JOBS — the health check would never notice
 *     this job exists at all, so it can fail silently forever.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_CRON_JOBS } from "../../lib/cron-health.mjs";
import { selfTest } from "../lib/self-test.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONS_DIR = path.join(REPO_ROOT, "prisma", "migrations");

/** Every `cron.schedule('<name>'` job name registered in a `*cron*`-named migration directory. */
export function findRegisteredCronJobNames(migrationsDir = MIGRATIONS_DIR) {
  const names = new Set();
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().includes("cron"))
    .map((entry) => entry.name);

  for (const dir of dirs) {
    const sqlPath = path.join(migrationsDir, dir, "migration.sql");
    let sql;
    try {
      sql = readFileSync(sqlPath, "utf8");
    } catch {
      continue; // a *cron*-named migration dir with no migration.sql is not this suite's problem
    }
    for (const match of sql.matchAll(/cron\.schedule\(\s*['"]([a-zA-Z0-9_-]+)['"]/g)) {
      names.add(match[1]);
    }
  }
  return { names: [...names].sort(), dirsScanned: dirs };
}

/**
 * Pure diff, tested without the filesystem in scheduled-layer-drift.test.mjs:
 * the two directions this suite floors at 0, kept as an exported function so
 * the set-difference logic itself is verified independently of migration
 * parsing.
 *
 * @param {ReadonlyArray<string>} expected
 * @param {ReadonlyArray<string>} registered
 * @returns {{ unregisteredExpected: string[], unexpectedRegistered: string[] }}
 */
export function diffCronRegistrations(expected, registered) {
  return {
    unregisteredExpected: expected.filter((name) => !registered.includes(name)),
    unexpectedRegistered: registered.filter((name) => !expected.includes(name)),
  };
}

/** @param {object} ctx @returns {Promise<{ metrics: Array<object> }>} */
export async function run(ctx) {
  const migrationsDir = ctx?.fixture?.migrationsDir
    ? path.join(REPO_ROOT, ctx.fixture.migrationsDir)
    : MIGRATIONS_DIR;
  const { names: registered, dirsScanned } = findRegisteredCronJobNames(migrationsDir);
  const expected = [...EXPECTED_CRON_JOBS];
  const { unregisteredExpected, unexpectedRegistered } = diffCronRegistrations(expected, registered);

  return {
    metrics: [
      {
        id: "unregistered_expected_jobs",
        value: unregisteredExpected.length,
        n: expected.length,
        details: { jobs: unregisteredExpected, expected, registered, dirsScanned },
      },
      {
        id: "unexpected_registered_jobs",
        value: unexpectedRegistered.length,
        n: registered.length,
        details: { jobs: unexpectedRegistered, expected, registered, dirsScanned },
      },
    ],
  };
}

await selfTest(import.meta.url, run);
