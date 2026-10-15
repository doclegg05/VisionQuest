import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { EXPECTED_CRON_JOBS } from "../../scripts/lib/cron-health.mjs";

// A pg_cron job lives in three places: the migration that registers it, the
// route it calls, and the health check's list of jobs to expect. Two stall
// detectors shipped with a route and no job, and their routes sat under
// /api/cron, where src/proxy.ts rejects a bearer call that has no Origin
// header (review F6, 2026-09-01; issue #39). These checks keep the three in
// step.

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));
const API_DIR = fileURLToPath(new URL("../app/api/", import.meta.url));

interface ScheduledJob {
  name: string;
  schedule: string;
  method: "GET" | "POST";
  path: string;
  migration: string;
}

const CRON_SCHEDULE_CALL =
  /cron\.schedule\(\s*'([a-z0-9-]+)',\s*'([^']+)',\s*\$cmd\$([\s\S]*?)\$cmd\$/g;

function parseJobs(migration: string, sql: string): ScheduledJob[] {
  return [...sql.matchAll(CRON_SCHEDULE_CALL)].map(([, name, schedule, command]) => {
    const method = /net\.http_get\(/.test(command) ? "GET" : "POST";
    const path = command.match(/'(\/api\/[a-z0-9/-]+)'/)?.[1];
    assert.ok(path, `${migration}: job ${name} names no /api path`);
    return { name, schedule, method, path, migration };
  });
}

/** cron.schedule() upserts by jobname, so the latest migration to name a job wins. */
function registeredJobs(): Map<string, ScheduledJob> {
  const jobs = new Map<string, ScheduledJob>();
  const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const migration of migrations) {
    const file = `${MIGRATIONS_DIR}${migration}/migration.sql`;
    if (!existsSync(file)) continue;
    for (const job of parseJobs(migration, readFileSync(file, "utf8"))) {
      jobs.set(job.name, job);
    }
  }
  return jobs;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = `${dir}${entry.name}`;
    if (entry.isDirectory()) return routeFiles(`${full}/`);
    return entry.name === "route.ts" ? [full] : [];
  });
}

const jobs = registeredJobs();

describe("pg_cron job registrations", () => {
  it("registers both stall detectors against /api/internal routes", () => {
    for (const name of ["evidence-gap-detection", "goal-stale-detection"]) {
      const job = jobs.get(name);
      assert.ok(job, `no migration registers ${name}`);
      assert.equal(job.method, "POST");
      assert.equal(job.path, `/api/internal/${name}`);
    }
  });

  it("points every job at a route that exists and exports the job's method", () => {
    for (const job of jobs.values()) {
      const file = `${REPO_ROOT}src/app${job.path}/route.ts`;
      assert.ok(existsSync(file), `${job.name} (${job.migration}) calls ${job.path}, which has no route.ts`);
      const exportsMethod = new RegExp(
        `export\\s+(async\\s+function\\s+${job.method}\\b|const\\s+${job.method}\\b)`,
      );
      assert.match(
        readFileSync(file, "utf8"),
        exportsMethod,
        `${job.name} sends ${job.method} but ${job.path} does not export it`,
      );
    }
  });

  // The scheduled-layer-drift benchmark checks the same names but reads only
  // migration folders with "cron" in the name; this reads every migration.
  it("is what npm run cron:health expects, no more and no less", () => {
    assert.deepEqual([...EXPECTED_CRON_JOBS].sort(), [...jobs.keys()].sort());
  });
});

describe("bearer-authenticated routes", () => {
  it("live under /api/internal, the only prefix the proxy lets a bearer call through", () => {
    const outside = routeFiles(API_DIR)
      .filter((file) => readFileSync(file, "utf8").includes("CRON_SECRET"))
      .map((file) => relative(REPO_ROOT, file))
      .filter((file) => !file.startsWith("src/app/api/internal/"));
    assert.deepEqual(outside, []);
  });
});
